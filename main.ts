import { App, Plugin, PluginManifest, PluginSettingTab, Setting, Tasks } from "obsidian";

import serializeJS from "serialize-javascript";

// Ensure that we can register the storage on the window to make it easy to access.
declare global {
  interface Window {
    pkvs?: PersistentStoreGlobal;
  }
}

// The default state of the save every time option.
const DEFAULT_LAZY_PERSISTENCE: boolean = false;

interface PKVSPluginSettings {
  lazyPersistence: boolean;
  persistedData: string;
}

const DEFAULT_SETTINGS: PKVSPluginSettings = {
  lazyPersistence: DEFAULT_LAZY_PERSISTENCE,
  persistedData: "{}",
};

export default class PKVSPlugin extends Plugin {
  settings: PKVSPluginSettings;
  dataStore: PersistentStore;
  storeInterface: PersistentStoreGlobal;

  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
    this.settings = DEFAULT_SETTINGS;
    this.dataStore = new PersistentStore(this);
    this.storeInterface = new PersistentStoreGlobal(this);
  }

  // Functionality that runs when the plugin is loaded, rather than when it is instantiated.
  override async onload() {
    // Load settings and persisted data.
    await this.loadSettings();
    this.dataStore.loadData();

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new PKVSSettingsTab(this.app, this));

    // Register the persistent store on the window.
    window.pkvs = this.storeInterface;

    // Add a command to force saving by the plugin.
    this.addCommand({
      id: "persist",
      name: "Persist Data",
      repeatable: false,
      callback: async () => {
        const plugin = this;
        await plugin.dataStore.storeData();
      },
    });

    // Make a best effort to save data when quitting Obsidian.
    this.registerEvent(
      this.app.workspace.on("quit", async (_: Tasks) => {
        await this.dataStore.storeData();
      }),
    );
  }

  // Things that are done
  override async onunload() {
    // Force data to be saved
    await this.dataStore.storeData();

    // Remove the global access as well.
    delete window.pkvs;
  }

  // Loads the plugin's settings from disk.
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  // Saves the plugin's settings to disk.
  async saveSettings() {
    await this.saveData(this.settings);
  }

  // Returns `true` if the plugin is set up to persist to disk with every operation, or false
  // otherwise.
  eagerPersistenceEnabled(): boolean {
    return !this.settings.lazyPersistence;
  }
}

// The settings tab for the plugin.
class PKVSSettingsTab extends PluginSettingTab {
  plugin: PKVSPlugin;

  constructor(app: App, plugin: PKVSPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Lazy Persistence")
      .setDesc(
        "Changes will be persisted to disk at app close on a best effort basis. Enabling lazy persistence may result in data loss unless you manually persist data as needed. Lazy persistence is likely faster if you are performing lots of reads and writes of large amounts of data.",
      )
      .addToggle((component) => {
        component.setValue(this.plugin.settings.lazyPersistence).onChange(async (value) => {
          this.plugin.settings.lazyPersistence = value;
          await this.plugin.saveSettings();
        });
      });
  }
}

// The persistent data store itself. It is not intended to be exposed to users.
class PersistentStore {
  plugin: PKVSPlugin;
  data: { [key: PropertyKey]: any };

  constructor(plugin: PKVSPlugin) {
    this.plugin = plugin;
    this.data = this.loadFromString(this.plugin.settings.persistedData);
  }

  loadFromString(data: string): { [key: PropertyKey]: any } {
    const indirectEval = eval;
    return indirectEval(`(${data})`);
  }

  storeToString(): string {
    return serializeJS(this.data);
  }

  async loadData(): Promise<void> {
    await this.plugin.loadSettings();
    this.data = this.loadFromString(this.plugin.settings.persistedData);
  }

  async storeData(): Promise<void> {
    this.plugin.settings.persistedData = this.storeToString();
    await this.plugin.saveSettings();
  }

  async existsMember(key: PropertyKey): Promise<boolean> {
    return this.data.hasOwnProperty(key);
  }

  async deleteMember(key: PropertyKey): Promise<any> {
    const oldValue = this.data[key];
    delete this.data[key];
    return oldValue;
  }

  async storeMember(key: PropertyKey, value: any): Promise<any> {
    const oldValue = this.data[key];
    this.data[key] = value;
    return oldValue;
  }

  async loadMember(key: PropertyKey): Promise<any> {
    return this.data[key];
  }
}

// The user-facing interface to the persistent key-value store.
class PersistentStoreGlobal {
  private plugin: PKVSPlugin;
  private dataStore: PersistentStore;
  private lazyPersistenceOverride: boolean | undefined;

  constructor(plugin: PKVSPlugin) {
    this.plugin = plugin;
    this.dataStore = this.plugin.dataStore;
    this.lazyPersistenceOverride = undefined;
  }

  // Persists data to disk if eager persistence is enabled.
  private async persistIfEnabled(): Promise<void> {
    if (!this.lazyPersistenceOverride) {
      if (this.plugin.eagerPersistenceEnabled()) {
        await this.dataStore.storeData();
      }
    }
  }

  // Loads the value at `key` in the persistent data, returning the value if it exists or
  // `undefined` otherwise.
  async load(key: PropertyKey): Promise<any> {
    return await this.dataStore.loadMember(key);
  }

  // Stores the provided `value` at the provided `key` in the data store, returning the previous
  // value at that `key` if it was previously written, or `undefined` otherwise.
  //
  // If eager persistence is on, this will write the changes to disk before returning.
  async store(key: PropertyKey, value: any): Promise<any> {
    const previousValue = await this.dataStore.storeMember(key, value);
    await this.persistIfEnabled();
    return previousValue;
  }

  // Deletes any value at the provided `key`, returning the previous value if `key` was previously
  // written, or `undefined` otherwise.
  //
  // If eager persistence is on, this will write the changes to disk before returning.
  async delete(key: PropertyKey): Promise<any> {
    const previousValue = await this.dataStore.deleteMember(key);
    await this.persistIfEnabled();
    return previousValue;
  }

  // Returns `true` if `key` exists in the data store, or `false` otherwise.
  async exists(key: PropertyKey): Promise<boolean> {
    return await this.dataStore.existsMember(key);
  }

  // Forces any in-memory changes to the data store to be written to disk. Once it has returned, the
  // on-disk state and in-memory state are guaranteed to be the same.
  async persist(): Promise<void> {
    await this.dataStore.storeData();
  }

  // Sets the store to use lazy persistence regardless of the option in settings.
  setLazyPersistance(): void {
    this.lazyPersistenceOverride = true;
  }

  // Sets the store to use eager persistence regardless of the option in settings.
  setEagerPersistence(): void {
    this.lazyPersistenceOverride = false;
  }

  // Sets the store to persist as specified by the option in settings.
  disablePersistenceOverride(): void {
    this.lazyPersistenceOverride = undefined;
  }
}
