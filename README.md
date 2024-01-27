# Persistent Key-Value Store for Obsidian

This plugin provides a persistent key-value store for use inside scripts in Obsidian. This means
that you can persist data between runs of [Templater](https://github.com/SilentVoid13/Templater)
templates or [Dataview](https://github.com/blacksmithgu/obsidian-dataview) (or
[Datacore](https://github.com/blacksmithgu/datacore)) queries.

Note that this plugin uses eval under the hood in combination with
[serialize-javascript](https://github.com/yahoo/serialize-javascript) to allow for serialization of
rich JS objects. You must **never store or load untrusted data**, and **usage of this plugin is at
your own risk**.

## Usage

This plugin is intended to be used from _other plugins_ (such as those mentioned above) that allow
you to execute JavaScript code in the Obsidian JS virtual machine. It is not intended to be
user-facing or provide a non-code interface outside of its settings. If you are not familiar with
JavaScript, or its use to script Obsidian, this plugin is **not for you**.

### Interface

The data store is made available to you in the window scope under the name `window.pkvs` (implicitly
accessible as `pkvs`). The operations available to you are given by the following interface.

```ts
// The user-facing interface to the persistent key-value store.
interface PKVS {
  // Loads the value at `key` in the persistent data, returning the value if it exists or
  // `undefined` otherwise.
  async load(key: PropertyKey): Promise<any>;

  // Stores the provided `value` at the provided `key` in the data store, returning the previous
  // value at that `key` if it was previously written, or `undefined` otherwise.
  //
  // If eager persistence is on, this will write the changes to disk before returning.
  async store(key: PropertyKey, value: any): Promise<any>;

  // Deletes any value at the provided `key`, returning the previous value if `key` was previously
  // written, or `undefined` otherwise.
  //
  // If eager persistence is on, this will write the changes to disk before returning.
  async delete(key: PropertyKey): Promise<any>;

  // Returns `true` if `key` exists in the data store, or `false` otherwise.
  async exists(key: PropertyKey): Promise<boolean>;

  // Forces any in-memory changes to the data store to be written to disk. Once it has returned, the
  // on-disk state and in-memory state are guaranteed to be the same.
  async persist(): Promise<void>;

  // Sets the store to use lazy persistence regardless of the option in settings.
  setLazyPersistance(): void;

  // Sets the store to use eager persistence regardless of the option in settings.
  setEagerPersistence(): void;

  // Sets the store to persist as specified by the option in settings.
  disablePersistenceOverride(): void;
```

## Performance

If you are writing and reading lots of data or large data at once, you may want to enable the "Lazy
Persistence" option in settings. This will only persist data to disk at app-close on a best-effort
basis, and instead requires you to manually persist. You can also enable this option
_programmatically_ by calling `setLazyPersistance` and `setEagerPersistence` as shown above. These
will not change the setting for the plugin, but only the currently active behavior.

Manual persistence can be performed by calling `persist` above and awaiting on the result to return
to guarantee writing is complete, or running the "Persist Data" command from the command palette.

> ### WARNING
>
> Please note that use of lazy persistence **may incur data loss** if you do not persist before
> closing Obsidian. This is particularly relevant on mobile, where the app may be killed in the
> background at any time.

## Installation

You can install the plugin using the following two installation methods.

### Community Plugins

Currently awaiting approval to be added to the community plugins registry.

### BRAT

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat).
2. In BRAT settings, select "Add Beta Plugin" and paste
   `https://github.com/iamrecursion/obsidian-pkvs` as the URL.
3. Go to the "Community Plugins" tab and enable the plugin.

## Contributing

If you are interested in contributing code, documentation, or ideas to this project, please take a
look at the `[CONTRIBUTING](./CONTRIBUTING.md)` guide.
