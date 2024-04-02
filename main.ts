import eruda, { Eruda, Tool } from "eruda";
import {
  App,
  Platform,
  Plugin,
  PluginManifest,
  PluginSettingTab,
  Setting,
  Tasks,
  ToggleComponent,
} from "obsidian";

import serializeJS from "serialize-javascript";

import erudaBenchmark from "eruda-benchmark";
import erudaCode from "eruda-code";
import erudaFeatures from "eruda-features";
import erudaGeolocation from "eruda-geolocation";
import erudaMonitor from "eruda-monitor";
import erudaOrientation from "eruda-orientation";
import erudaTiming from "eruda-timing";
import erudaTouches from "eruda-touches";

// Ensure that we can register the storage on the window to make it easy to access.
declare global {
  interface Window {
    pkvs?: PersistentStoreGlobal;
    eruda?: Eruda;
  }
}

// The default state of the save every time option.
const DEFAULT_LAZY_PERSISTENCE: boolean = false;

interface PKVSPluginSettings {
  // Persistence-Related Settings
  lazyPersistence: boolean;
  persistedData: string;

  // Inspector-Related Settings
  enableDomTab: boolean;
  enableNetworkTab: boolean;
  enableResourcesTab: boolean;
  enableInfoTab: boolean;
  enableSnippetsTab: boolean;
  enableSourcesTab: boolean;
  enableBenchmarkingToolkit: boolean;
  enableCodeTab: boolean;
  enableFeaturesTab: boolean;
  enableGeolocationTab: boolean;
  enableMonitorTab: boolean;
  enableOrientationTab: boolean;
  enableTimingTab: boolean;
  enableTouchesTab: boolean;
}

const DEFAULT_SETTINGS: PKVSPluginSettings = {
  // Persistence-Related Settings
  lazyPersistence: DEFAULT_LAZY_PERSISTENCE,
  persistedData: "{}",

  // Inspector-Related Settings
  enableDomTab: false,
  enableInfoTab: false,
  enableNetworkTab: false,
  enableResourcesTab: false,
  enableSnippetsTab: false,
  enableSourcesTab: false,
  enableBenchmarkingToolkit: false,
  enableCodeTab: false,
  enableFeaturesTab: false,
  enableGeolocationTab: false,
  enableMonitorTab: false,
  enableOrientationTab: false,
  enableTimingTab: false,
  enableTouchesTab: false,
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

    // This adds a settings tab so the user can configure various aspects of the plugin.
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

    // Add a command to create a new virtual web inspector
    this.addCommand({
      id: "inspector:new",
      name: "New Virtual Web Inspector",
      repeatable: false,
      callback: async () => {
        const plugin = this;
        await plugin.newInspector();
      },
    });

    this.addCommand({
      id: "inspector:exit",
      name: "Exit Virtual Web Inspector",
      repeatable: false,
      callback: async () => {
        const plugin = this;
        await plugin.exitInspector();
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

  // Creates and opens a new virtual console.
  async newInspector(): Promise<void> {
    // We always provide the console.
    let tools = ["console"];

    // And then other tabs can be added conditionally.
    if (this.settings.enableDomTab) {
      tools.push("elements");
    }
    if (this.settings.enableInfoTab) {
      tools.push("info");
    }
    if (this.settings.enableNetworkTab) {
      tools.push("network");
    }
    if (this.settings.enableResourcesTab) {
      tools.push("resources");
    }
    if (this.settings.enableSnippetsTab) {
      tools.push("snippets");
    }
    if (this.settings.enableSourcesTab) {
      tools.push("sources");
    }

    // Initialize the inspector itself.
    eruda.init({
      tool: tools,
      useShadowDom: true,
      autoScale: true,
      defaults: {
        displaySize: 50,
        transparency: 0.9,
        theme: "Monokai Pro",
      },
    });

    // Add any plugin-based tabs conditionally.
    if (this.settings.enableBenchmarkingToolkit) {
      eruda.add(erudaBenchmark as Tool);
    }
    if (this.settings.enableCodeTab) {
      eruda.add(erudaCode as Tool);
    }
    if (this.settings.enableFeaturesTab) {
      eruda.add(erudaFeatures as Tool);
    }
    if (this.settings.enableGeolocationTab) {
      eruda.add(erudaGeolocation as Tool);
    }
    if (this.settings.enableMonitorTab) {
      eruda.add(erudaMonitor as Tool);
    }
    if (this.settings.enableOrientationTab && Platform.isMobile) {
      eruda.add(erudaOrientation as Tool);
    }
    if (this.settings.enableTimingTab) {
      eruda.add(erudaTiming as Tool);
    }
    if (this.settings.enableTouchesTab && Platform.isMobile) {
      eruda.add(erudaTouches as Tool);
    }
  }

  // Exists the virtual console if it exists.
  async exitInspector(): Promise<void> {
    if (window.eruda) {
      eruda.destroy();
    }
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

    this.containerEl.createEl("h3", { text: "Peristence Settings" });
    this.containerEl.createEl("p", {
      text: "These settings deal with how data in the in-memory store is persisted to disk. Please read the plugin documentation before changing these",
    });

    this._createToggle(
      "lazyPersistence",
      "Lazy Persistence",
      "Changes will be persisted to disk at app close on a best effort basis. Enabling lazy persistence may result in data loss unless you manually persist data as needed. Lazy persistence is likely faster if you are performing lots of reads and writes of large amounts of data.",
    );

    this.containerEl.createEl("h3", { text: "Web Inspector Settings" });
    this.containerEl.createEl("p", {
      text: "As sometimes you just want to be able to write JavaScript to interact with the persistent data store, this plugin includes a virtual web inspector. These settings allow you to enable and disable modules in the virtual web inspector.",
    });
    this.containerEl.createEl("p", {
      text: "Note that changing these will not take effect until you kill and restart the inspector.",
    });

    this._createToggle(
      "enableDomTab",
      "Enable DOM Tab",
      "Lets you view the DOM and select items by tapping on them.",
    );
    this._createToggle(
      "enableInfoTab",
      "Enable Info Tab",
      "Allows displaying arbitrary user-created information. By default displays page URL and User Agent.",
    );
    this._createToggle(
      "enableNetworkTab",
      "Enable Network Tab",
      "Shows the status of network requests.",
    );
    this._createToggle(
      "enableResourcesTab",
      "Enable Resources Tab",
      "Shows information on data in local storage and cookies.",
    );
    this._createToggle(
      "enableSnippetsTab",
      "Enable Snippets Tab",
      "Includes useful snippets for interacting with and inspecting the DOM.",
    );
    this._createToggle(
      "enableSourcesTab",
      "Enable Sources Tab",
      "A viewer for the HTML, CSS and JavaScript sources of the page.",
    );
    this._createToggle(
      "enableBenchmarkingToolkit",
      "Enable Benchmarking Tools",
      "Enables the Eruda Benchmark library for running local benchmarks.",
    );
    this._createToggle(
      "enableCodeTab",
      "Enable Code Tab",
      "A code editor for JavaScript which can run it directly in the inspector.",
    );
    this._createToggle(
      "enableFeaturesTab",
      "Enable Feature-Detection Tab",
      "Feature detection for the current platform.",
    );
    this._createToggle(
      "enableGeolocationTab",
      "Enable Geolocation Tab",
      "A utility tab for testing geolocation features.",
    );
    this._createToggle(
      "enableMonitorTab",
      "Enable Monitoring Tab",
      "A graph of rendering frame-rate and JS heap usage.",
    );
    this._createToggle(
      "enableOrientationTab",
      "Enable Orientation Tab",
      "A utility tab for testing device orientation features. Disabled on desktop.",
    );
    this._createToggle("enableTimingTab", "Enable Timing Tab", "Performance and resource timing.");
    this._createToggle(
      "enableTouchesTab",
      "Enable Touches Tab",
      "A utility tab for displaying touches onscreen. Disabled on desktop.",
    );
  }

  /** Creates a toggle setting.
   *
   * @param settingsProperty The name of the property in `InobsidianSettings`
   * that this setting is associated with.
   * @param name The name of the setting to be shown to the user.
   * @param description A description of the setting that will be shown to the
   * user.
   */
  _createToggle<Key extends string & BooleanPropsOf<PKVSPluginSettings>>(
    settingsProperty: Key,
    name: string | DocumentFragment,
    description: string | DocumentFragment,
  ): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(description)
      .addToggle((component: ToggleComponent) => {
        return component
          .setValue(this.plugin.settings[settingsProperty])
          .onChange((newValue: PKVSPluginSettings[Key]) => {
            this.plugin.settings[settingsProperty] = newValue;
            this.plugin.saveSettings();
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

// Type-Level Functions =======================================================

/** Produces the set of keys of type `boolean` in the provided `Type`.
 *
 * @param Type the type to get the keys from
 */
type BooleanPropsOf<Type> = keyof {
  // We filter things from a mapped type by producing `never`.
  [K in keyof Type as Type[K] extends boolean ? K : never]: K;
};
