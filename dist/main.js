// src/index.js
var Obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  api_key: "",
  api_endpoint: "https://api.openai.com",
  chat_open: true,
  file_exclusions: "",
  folder_exclusions: "",
  header_exclusions: "",
  path_only: "",
  show_full_path: false,
  expanded_view: true,
  group_nearest_by_file: false,
  language: "zh",
  log_render: false,
  log_render_files: false,
  recently_sent_retry_notice: false,
  skip_sections: false,
  smart_chat_model: "gpt-3.5-turbo-16k",
  view_open: true,
  version: ""
};
var MAX_EMBED_STRING_LENGTH = 25e3;
var VERSION;
var SUPPORTED_FILE_TYPES = ["md", "canvas"];
var VecLite = class {
  constructor(config) {
    this.config = {
      file_name: "embeddings-3.json",
      folder_path: ".vec_lite",
      exists_adapter: null,
      mkdir_adapter: null,
      read_adapter: null,
      rename_adapter: null,
      stat_adapter: null,
      write_adapter: null,
      ...config
    };
    this.file_name = this.config.file_name;
    this.folder_path = config.folder_path;
    this.file_path = this.folder_path + "/" + this.file_name;
    this.embeddings = false;
  }
  async file_exists(path) {
    if (this.config.exists_adapter) {
      return await this.config.exists_adapter(path);
    } else {
      throw new Error("exists_adapter not set");
    }
  }
  async mkdir(path) {
    if (this.config.mkdir_adapter) {
      return await this.config.mkdir_adapter(path);
    } else {
      throw new Error("mkdir_adapter not set");
    }
  }
  async read_file(path) {
    if (this.config.read_adapter) {
      return await this.config.read_adapter(path);
    } else {
      throw new Error("read_adapter not set");
    }
  }
  async rename(old_path, new_path) {
    if (this.config.rename_adapter) {
      return await this.config.rename_adapter(old_path, new_path);
    } else {
      throw new Error("rename_adapter not set");
    }
  }
  async stat(path) {
    if (this.config.stat_adapter) {
      return await this.config.stat_adapter(path);
    } else {
      throw new Error("stat_adapter not set");
    }
  }
  async write_file(path, data) {
    if (this.config.write_adapter) {
      return await this.config.write_adapter(path, data);
    } else {
      throw new Error("write_adapter not set");
    }
  }
  async load(retries = 0) {
    try {
      const embeddings_file = await this.read_file(this.file_path);
      this.embeddings = JSON.parse(embeddings_file);
      console.log("loaded embeddings file: " + this.file_path);
      return true;
    } catch (error) {
      if (retries < 3) {
        console.log("retrying load()");
        await new Promise((r) => setTimeout(r, 1e3 + 1e3 * retries));
        return await this.load(retries + 1);
      } else if (retries === 3) {
        const embeddings_2_file_path = this.folder_path + "/embeddings-2.json";
        const embeddings_2_file_exists = await this.file_exists(embeddings_2_file_path);
        if (embeddings_2_file_exists) {
          await this.migrate_embeddings_v2_to_v3();
          return await this.load(retries + 1);
        }
      }
      console.log("failed to load embeddings file, prompt user to initiate bulk embed");
      return false;
    }
  }
  async migrate_embeddings_v2_to_v3() {
    console.log("migrating embeddings-2.json to embeddings-3.json");
    const embeddings_2_file_path = this.folder_path + "/embeddings-2.json";
    const embeddings_2_file = await this.read_file(embeddings_2_file_path);
    const embeddings_2 = JSON.parse(embeddings_2_file);
    const embeddings_3 = {};
    for (const [key, value] of Object.entries(embeddings_2)) {
      const new_obj = {
        vec: value.vec,
        meta: {}
      };
      const meta = value.meta;
      const new_meta = {};
      if (meta.hash)
        new_meta.hash = meta.hash;
      if (meta.file)
        new_meta.parent = meta.file;
      if (meta.blocks)
        new_meta.children = meta.blocks;
      if (meta.mtime)
        new_meta.mtime = meta.mtime;
      if (meta.size)
        new_meta.size = meta.size;
      if (meta.len)
        new_meta.size = meta.len;
      if (meta.path)
        new_meta.path = meta.path;
      new_meta.src = "file";
      new_obj.meta = new_meta;
      embeddings_3[key] = new_obj;
    }
    const embeddings_3_file = JSON.stringify(embeddings_3);
    await this.write_file(this.file_path, embeddings_3_file);
  }
  async init_embeddings_file() {
    if (!await this.file_exists(this.folder_path)) {
      await this.mkdir(this.folder_path);
      console.log("created folder: " + this.folder_path);
    } else {
      console.log("folder already exists: " + this.folder_path);
    }
    if (!await this.file_exists(this.file_path)) {
      await this.write_file(this.file_path, "{}");
      console.log("created embeddings file: " + this.file_path);
    } else {
      console.log("embeddings file already exists: " + this.file_path);
    }
  }
  async save() {
    const embeddings = JSON.stringify(this.embeddings);
    const embeddings_file_exists = await this.file_exists(this.file_path);
    if (embeddings_file_exists) {
      const new_file_size = embeddings.length;
      const existing_file_size = await this.stat(this.file_path).then((stat) => stat.size);
      if (new_file_size > existing_file_size * 0.5) {
        await this.write_file(this.file_path, embeddings);
        console.log("embeddings file size: " + new_file_size + " bytes");
      } else {
        const warning_message = [
          "Warning: New embeddings file size is significantly smaller than existing embeddings file size.",
          "Aborting to prevent possible loss of embeddings data.",
          "New file size: " + new_file_size + " bytes.",
          "Existing file size: " + existing_file_size + " bytes.",
          "Restarting Obsidian may fix this."
        ];
        console.log(warning_message.join(" "));
        await this.write_file(this.folder_path + "/unsaved-embeddings.json", embeddings);
        throw new Error("Error: New embeddings file size is significantly smaller than existing embeddings file size. Aborting to prevent possible loss of embeddings data.");
      }
    } else {
      await this.init_embeddings_file();
      return await this.save();
    }
    return true;
  }
  cos_sim(vector1, vector2) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vector1.length; i++) {
      dotProduct += vector1[i] * vector2[i];
      normA += vector1[i] * vector1[i];
      normB += vector2[i] * vector2[i];
    }
    if (normA === 0 || normB === 0) {
      return 0;
    } else {
      return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
  }
  nearest(to_vec, filter = {}) {
    filter = {
      results_count: 30,
      ...filter
    };
    let nearest = [];
    const from_keys = Object.keys(this.embeddings);
    for (let i = 0; i < from_keys.length; i++) {
      if (filter.skip_sections) {
        const from_path = this.embeddings[from_keys[i]].meta.path;
        if (from_path.indexOf("#") > -1)
          continue;
      }
      if (filter.skip_key) {
        if (filter.skip_key === from_keys[i])
          continue;
        if (filter.skip_key === this.embeddings[from_keys[i]].meta.parent)
          continue;
      }
      if (filter.path_begins_with) {
        if (typeof filter.path_begins_with === "string" && !this.embeddings[from_keys[i]].meta.path.startsWith(filter.path_begins_with))
          continue;
        if (Array.isArray(filter.path_begins_with) && !filter.path_begins_with.some((path) => this.embeddings[from_keys[i]].meta.path.startsWith(path)))
          continue;
      }
      nearest.push({
        link: this.embeddings[from_keys[i]].meta.path,
        similarity: this.cos_sim(to_vec, this.embeddings[from_keys[i]].vec),
        size: this.embeddings[from_keys[i]].meta.size
      });
    }
    nearest.sort(function(a, b) {
      return b.similarity - a.similarity;
    });
    nearest = nearest.slice(0, filter.results_count);
    return nearest;
  }
  find_nearest_embeddings(to_vec, filter = {}) {
    const default_filter = {
      max: this.max_sources
    };
    filter = { ...default_filter, ...filter };
    if (Array.isArray(to_vec) && to_vec.length !== this.vec_len) {
      this.nearest = {};
      for (let i = 0; i < to_vec.length; i++) {
        this.find_nearest_embeddings(to_vec[i], {
          max: Math.floor(filter.max / to_vec.length)
        });
      }
    } else {
      const from_keys = Object.keys(this.embeddings);
      for (let i = 0; i < from_keys.length; i++) {
        if (this.validate_type(this.embeddings[from_keys[i]]))
          continue;
        const sim = this.computeCosineSimilarity(to_vec, this.embeddings[from_keys[i]].vec);
        if (this.nearest[from_keys[i]]) {
          this.nearest[from_keys[i]] += sim;
        } else {
          this.nearest[from_keys[i]] = sim;
        }
      }
    }
    let nearest = Object.keys(this.nearest).map((key) => {
      return {
        key,
        similarity: this.nearest[key]
      };
    });
    nearest = this.sort_by_similarity(nearest);
    nearest = nearest.slice(0, filter.max);
    nearest = nearest.map((item) => {
      return {
        link: this.embeddings[item.key].meta.path,
        similarity: item.similarity,
        len: this.embeddings[item.key].meta.len || this.embeddings[item.key].meta.size
      };
    });
    return nearest;
  }
  sort_by_similarity(nearest) {
    return nearest.sort(function(a, b) {
      const a_score = a.similarity;
      const b_score = b.similarity;
      if (a_score > b_score)
        return -1;
      if (a_score < b_score)
        return 1;
      return 0;
    });
  }
  // check if key from embeddings exists in files
  clean_up_embeddings(files) {
    console.log("cleaning up embeddings");
    const keys = Object.keys(this.embeddings);
    let deleted_embeddings = 0;
    for (const key of keys) {
      const path = this.embeddings[key].meta.path;
      if (!files.find((file) => path.startsWith(file.path))) {
        delete this.embeddings[key];
        deleted_embeddings++;
        continue;
      }
      if (path.indexOf("#") > -1) {
        const parent_key = this.embeddings[key].meta.parent;
        if (!this.embeddings[parent_key]) {
          delete this.embeddings[key];
          deleted_embeddings++;
          continue;
        }
        if (!this.embeddings[parent_key].meta) {
          delete this.embeddings[key];
          deleted_embeddings++;
          continue;
        }
        if (this.embeddings[parent_key].meta.children && this.embeddings[parent_key].meta.children.indexOf(key) < 0) {
          delete this.embeddings[key];
          deleted_embeddings++;
          continue;
        }
      }
    }
    return { deleted_embeddings, total_embeddings: keys.length };
  }
  get(key) {
    return this.embeddings[key] || null;
  }
  get_meta(key) {
    const embedding = this.get(key);
    if (embedding && embedding.meta) {
      return embedding.meta;
    }
    return null;
  }
  get_mtime(key) {
    const meta = this.get_meta(key);
    if (meta && meta.mtime) {
      return meta.mtime;
    }
    return null;
  }
  get_hash(key) {
    const meta = this.get_meta(key);
    if (meta && meta.hash) {
      return meta.hash;
    }
    return null;
  }
  get_size(key) {
    const meta = this.get_meta(key);
    if (meta && meta.size) {
      return meta.size;
    }
    return null;
  }
  get_children(key) {
    const meta = this.get_meta(key);
    if (meta && meta.children) {
      return meta.children;
    }
    return null;
  }
  get_vec(key) {
    const embedding = this.get(key);
    if (embedding && embedding.vec) {
      return embedding.vec;
    }
    return null;
  }
  save_embedding(key, vec, meta) {
    this.embeddings[key] = {
      vec,
      meta
    };
  }
  mtime_is_current(key, source_mtime) {
    const mtime = this.get_mtime(key);
    if (mtime && mtime >= source_mtime) {
      return true;
    }
    return false;
  }
  async force_refresh() {
    this.embeddings = null;
    this.embeddings = {};
    let current_datetime = Math.floor(Date.now() / 1e3);
    await this.rename(this.file_path, this.folder_path + "/embeddings-" + current_datetime + ".json");
    await this.init_embeddings_file();
  }
};
var SMART_TRANSLATION = {
  "zh": {
    "pronous": ["\u6211", "\u6211\u7684", "\u4FFA", "\u6211\u4EEC", "\u6211\u4EEC\u7684"],
    "prompt": "\u57FA\u4E8E\u6211\u7684\u7B14\u8BB0",
    "initial_message": `\u4F60\u597D\uFF0C\u6211\u662F\u80FD\u901A\u8FC7 Smart Connections \u8BBF\u95EE\u4F60\u7684\u7B14\u8BB0\u7684 ChatGPT\u3002\u4F60\u53EF\u4EE5\u95EE\u6211\u5173\u4E8E\u4F60\u7B14\u8BB0\u7684\u95EE\u9898\uFF0C\u6211\u4F1A\u9605\u8BFB\u5E76\u7406\u89E3\u4F60\u7684\u7B14\u8BB0\uFF0C\u5E76\u5C3D\u529B\u56DE\u7B54\u4F60\u7684\u95EE\u9898\u3002`
  }
};
var crypto = require("crypto");
function md5(str) {
  return crypto.createHash("md5").update(str).digest("hex");
}
var SmartConnectionsPlugin = class extends Obsidian.Plugin {
  // constructor
  constructor() {
    super(...arguments);
    this.api = null;
    this.embeddings_loaded = false;
    this.file_exclusions = [];
    this.folders = [];
    this.has_new_embeddings = false;
    this.header_exclusions = [];
    this.nearest_cache = {};
    this.path_only = [];
    this.render_log = {};
    this.render_log.deleted_embeddings = 0;
    this.render_log.exclusions_logs = {};
    this.render_log.failed_embeddings = [];
    this.render_log.files = [];
    this.render_log.new_embeddings = 0;
    this.render_log.skipped_low_delta = {};
    this.render_log.token_usage = 0;
    this.render_log.tokens_saved_by_cache = 0;
    this.retry_notice_timeout = null;
    this.save_timeout = null;
    this.sc_branding = {};
    this.update_available = false;
  }
  async onload() {
    this.app.workspace.onLayoutReady(this.initialize.bind(this));
  }
  onunload() {
    this.output_render_log();
    console.log("unloading plugin");
  }
  async initialize() {
    console.log("testtest");
    console.log("Loading Smart Connections plugin");
    VERSION = this.manifest.version;
    await this.loadSettings();
    setTimeout(this.check_for_update.bind(this), 3e3);
    setInterval(this.check_for_update.bind(this), 108e5);
    this.addIcon();
    this.addCommand({
      id: "sc-find-notes",
      name: "Find: Make Smart Connections",
      icon: "pencil_icon",
      hotkeys: [],
      // editorCallback: async (editor) => {
      editorCallback: async (editor) => {
        if (editor.somethingSelected()) {
          let selected_text = editor.getSelection();
          await this.make_connections(selected_text);
        } else {
          this.nearest_cache = {};
          await this.make_connections();
        }
      }
    });
    this.addCommand({
      id: "smart-connections-view",
      name: "Open: View Smart Connections",
      callback: () => {
        this.open_view();
      }
    });
    this.addCommand({
      id: "smart-connections-chat",
      name: "Open: Smart Chat Conversation",
      callback: () => {
        this.open_chat();
      }
    });
    this.addCommand({
      id: "smart-connections-random",
      name: "Open: Random Note from Smart Connections",
      callback: () => {
        this.open_random_note();
      }
    });
    this.addSettingTab(new SmartConnectionsSettingsTab(this.app, this));
    this.registerView(SMART_CONNECTIONS_VIEW_TYPE, (leaf) => new SmartConnectionsView(leaf, this));
    this.registerView(SMART_CONNECTIONS_CHAT_VIEW_TYPE, (leaf) => new SmartConnectionsChatView(leaf, this));
    this.registerMarkdownCodeBlockProcessor("smart-connections", this.render_code_block.bind(this));
    if (this.settings.view_open) {
      this.open_view();
    }
    if (this.settings.chat_open) {
      this.open_chat();
    }
    if (this.settings.version !== VERSION) {
      this.settings.best_new_plugin = false;
      this.settings.version = VERSION;
      await this.saveSettings();
      this.open_view();
    }
    this.add_to_gitignore();
    this.api = new ScSearchApi(this.app, this);
    (window["SmartSearchApi"] = this.api) && this.register(() => delete window["SmartSearchApi"]);
  }
  async init_vecs() {
    this.smart_vec_lite = new VecLite({
      folder_path: ".smart-connections",
      exists_adapter: this.app.vault.adapter.exists.bind(this.app.vault.adapter),
      mkdir_adapter: this.app.vault.adapter.mkdir.bind(this.app.vault.adapter),
      read_adapter: this.app.vault.adapter.read.bind(this.app.vault.adapter),
      rename_adapter: this.app.vault.adapter.rename.bind(this.app.vault.adapter),
      stat_adapter: this.app.vault.adapter.stat.bind(this.app.vault.adapter),
      write_adapter: this.app.vault.adapter.write.bind(this.app.vault.adapter)
    });
    this.embeddings_loaded = await this.smart_vec_lite.load();
    return this.embeddings_loaded;
  }
  async upgrade() {
    const v2 = await Obsidian.requestUrl({
      url: "https://sc.corn.li/download/newest.json",
      method: "GET",
      headers: {
        "Content-Type": "application/json"
      }
    });
    if (v2.status !== 200)
      throw new Error(`Error downloading version 2: Status ${v2.status}`);
    await this.app.vault.adapter.write(".obsidian/plugins/smart-connections/main.js", v2.json.main);
    await this.app.vault.adapter.write(".obsidian/plugins/smart-connections/manifest.json", v2.json.manifest);
    await this.app.vault.adapter.write(".obsidian/plugins/smart-connections/styles.css", v2.json.styles);
    console.log("upgrade complete");
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (this.settings.file_exclusions && this.settings.file_exclusions.length > 0) {
      this.file_exclusions = this.settings.file_exclusions.split(",").map((file) => {
        return file.trim();
      });
    }
    if (this.settings.folder_exclusions && this.settings.folder_exclusions.length > 0) {
      const folder_exclusions = this.settings.folder_exclusions.split(",").map((folder) => {
        folder = folder.trim();
        if (folder.slice(-1) !== "/") {
          return folder + "/";
        } else {
          return folder;
        }
      });
      this.file_exclusions = this.file_exclusions.concat(folder_exclusions);
    }
    if (this.settings.header_exclusions && this.settings.header_exclusions.length > 0) {
      this.header_exclusions = this.settings.header_exclusions.split(",").map((header) => {
        return header.trim();
      });
    }
    if (this.settings.path_only && this.settings.path_only.length > 0) {
      this.path_only = this.settings.path_only.split(",").map((path) => {
        return path.trim();
      });
    }
    await this.load_failed_files();
  }
  async saveSettings(rerender = false) {
    await this.saveData(this.settings);
    await this.loadSettings();
    if (rerender) {
      this.nearest_cache = {};
      await this.make_connections();
    }
  }
  // check for update
  async check_for_update() {
    try {
      const response = await (0, Obsidian.requestUrl)({
        url: "https://api.github.com/repos/brianpetro/obsidian-smart-connections/releases/latest",
        method: "GET",
        headers: {
          "Content-Type": "application/json"
        },
        contentType: "application/json"
      });
      const latest_release = JSON.parse(response.text).tag_name;
      if (latest_release !== VERSION) {
        new Obsidian.Notice(`[Smart Connections] A new version is available! (v${latest_release})`);
        this.update_available = true;
        this.render_brand("all");
      }
    } catch (error) {
      console.log(error);
    }
  }
  async render_code_block(contents, container, ctx) {
    let nearest;
    if (contents.trim().length > 0) {
      nearest = await this.api.search(contents);
    } else {
      console.log(ctx);
      const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
      nearest = await this.find_note_connections(file);
    }
    if (nearest.length) {
      this.update_results(container, nearest);
    }
  }
  async make_connections(selected_text = null) {
    let view = this.get_view();
    if (!view) {
      await this.open_view();
      view = this.get_view();
    }
    await view.render_connections(selected_text);
  }
  addIcon() {
    Obsidian.addIcon("smart-connections", `<path d="M50,20 L80,40 L80,60 L50,100" stroke="currentColor" stroke-width="4" fill="none"/>
    <path d="M30,50 L55,70" stroke="currentColor" stroke-width="5" fill="none"/>
    <circle cx="50" cy="20" r="9" fill="currentColor"/>
    <circle cx="80" cy="40" r="9" fill="currentColor"/>
    <circle cx="80" cy="70" r="9" fill="currentColor"/>
    <circle cx="50" cy="100" r="9" fill="currentColor"/>
    <circle cx="30" cy="50" r="9" fill="currentColor"/>`);
  }
  // open random note
  async open_random_note() {
    const curr_file = this.app.workspace.getActiveFile();
    const curr_key = md5(curr_file.path);
    if (typeof this.nearest_cache[curr_key] === "undefined") {
      new Obsidian.Notice("[Smart Connections] No Smart Connections found. Open a note to get Smart Connections.");
      return;
    }
    const rand = Math.floor(Math.random() * this.nearest_cache[curr_key].length / 2);
    const random_file = this.nearest_cache[curr_key][rand];
    this.open_note(random_file);
  }
  async open_view() {
    if (this.get_view()) {
      console.log("Smart Connections view already open");
      return;
    }
    this.app.workspace.detachLeavesOfType(SMART_CONNECTIONS_VIEW_TYPE);
    await this.app.workspace.getRightLeaf(false).setViewState({
      type: SMART_CONNECTIONS_VIEW_TYPE,
      active: true
    });
    this.app.workspace.revealLeaf(
      this.app.workspace.getLeavesOfType(SMART_CONNECTIONS_VIEW_TYPE)[0]
    );
  }
  // source: https://github.com/obsidianmd/obsidian-releases/blob/master/plugin-review.md#avoid-managing-references-to-custom-views
  get_view() {
    for (let leaf of this.app.workspace.getLeavesOfType(SMART_CONNECTIONS_VIEW_TYPE)) {
      if (leaf.view instanceof SmartConnectionsView) {
        return leaf.view;
      }
    }
  }
  // open chat view
  async open_chat(retries = 0) {
    if (!this.embeddings_loaded) {
      console.log("embeddings not loaded yet");
      if (retries < 3) {
        setTimeout(() => {
          this.open_chat(retries + 1);
        }, 1e3 * (retries + 1));
        return;
      }
      console.log("embeddings still not loaded, opening smart view");
      this.open_view();
      return;
    }
    this.app.workspace.detachLeavesOfType(SMART_CONNECTIONS_CHAT_VIEW_TYPE);
    await this.app.workspace.getRightLeaf(false).setViewState({
      type: SMART_CONNECTIONS_CHAT_VIEW_TYPE,
      active: true
    });
    this.app.workspace.revealLeaf(
      this.app.workspace.getLeavesOfType(SMART_CONNECTIONS_CHAT_VIEW_TYPE)[0]
    );
  }
  // get embeddings for all files
  async get_all_embeddings() {
    const files = (await this.app.vault.getFiles()).filter((file) => file instanceof Obsidian.TFile && (file.extension === "md" || file.extension === "canvas"));
    const open_files = this.app.workspace.getLeavesOfType("markdown").map((leaf) => leaf.view.file);
    const clean_up_log = this.smart_vec_lite.clean_up_embeddings(files);
    if (this.settings.log_render) {
      this.render_log.total_files = files.length;
      this.render_log.deleted_embeddings = clean_up_log.deleted_embeddings;
      this.render_log.total_embeddings = clean_up_log.total_embeddings;
    }
    let batch_promises = [];
    for (let i = 0; i < files.length; i++) {
      if (files[i].path.indexOf("#") > -1) {
        this.log_exclusion("path contains #");
        continue;
      }
      if (this.smart_vec_lite.mtime_is_current(md5(files[i].path), files[i].stat.mtime)) {
        continue;
      }
      if (this.settings.failed_files.indexOf(files[i].path) > -1) {
        if (this.retry_notice_timeout) {
          clearTimeout(this.retry_notice_timeout);
          this.retry_notice_timeout = null;
        }
        if (!this.recently_sent_retry_notice) {
          new Obsidian.Notice("Smart Connections: Skipping previously failed file, use button in settings to retry");
          this.recently_sent_retry_notice = true;
          setTimeout(() => {
            this.recently_sent_retry_notice = false;
          }, 6e5);
        }
        continue;
      }
      let skip = false;
      for (let j = 0; j < this.file_exclusions.length; j++) {
        if (files[i].path.indexOf(this.file_exclusions[j]) > -1) {
          skip = true;
          this.log_exclusion(this.file_exclusions[j]);
          break;
        }
      }
      if (skip) {
        continue;
      }
      if (open_files.indexOf(files[i]) > -1) {
        continue;
      }
      try {
        batch_promises.push(this.get_file_embeddings(files[i], false));
      } catch (error) {
        console.log(error);
      }
      if (batch_promises.length > 3) {
        await Promise.all(batch_promises);
        batch_promises = [];
      }
      if (i > 0 && i % 100 === 0) {
        await this.save_embeddings_to_file();
      }
    }
    await Promise.all(batch_promises);
    await this.save_embeddings_to_file();
    if (this.render_log.failed_embeddings.length > 0) {
      await this.save_failed_embeddings();
    }
  }
  async save_embeddings_to_file(force = false) {
    if (!this.has_new_embeddings) {
      return;
    }
    if (!force) {
      if (this.save_timeout) {
        clearTimeout(this.save_timeout);
        this.save_timeout = null;
      }
      this.save_timeout = setTimeout(() => {
        this.save_embeddings_to_file(true);
        if (this.save_timeout) {
          clearTimeout(this.save_timeout);
          this.save_timeout = null;
        }
      }, 3e4);
      console.log("scheduled save");
      return;
    }
    try {
      await this.smart_vec_lite.save();
      this.has_new_embeddings = false;
    } catch (error) {
      console.log(error);
      new Obsidian.Notice("Smart Connections: " + error.message);
    }
  }
  // save failed embeddings to file from render_log.failed_embeddings
  async save_failed_embeddings() {
    let failed_embeddings = [];
    const failed_embeddings_file_exists = await this.app.vault.adapter.exists(".smart-connections/failed-embeddings.txt");
    if (failed_embeddings_file_exists) {
      failed_embeddings = await this.app.vault.adapter.read(".smart-connections/failed-embeddings.txt");
      failed_embeddings = failed_embeddings.split("\r\n");
    }
    failed_embeddings = failed_embeddings.concat(this.render_log.failed_embeddings);
    failed_embeddings = [...new Set(failed_embeddings)];
    failed_embeddings.sort();
    failed_embeddings = failed_embeddings.join("\r\n");
    await this.app.vault.adapter.write(".smart-connections/failed-embeddings.txt", failed_embeddings);
    await this.load_failed_files();
  }
  // load failed files from failed-embeddings.txt
  async load_failed_files() {
    const failed_embeddings_file_exists = await this.app.vault.adapter.exists(".smart-connections/failed-embeddings.txt");
    if (!failed_embeddings_file_exists) {
      this.settings.failed_files = [];
      console.log("No failed files.");
      return;
    }
    const failed_embeddings = await this.app.vault.adapter.read(".smart-connections/failed-embeddings.txt");
    const failed_embeddings_array = failed_embeddings.split("\r\n");
    const failed_files = failed_embeddings_array.map((embedding) => embedding.split("#")[0]).reduce((unique, item) => unique.includes(item) ? unique : [...unique, item], []);
    this.settings.failed_files = failed_files;
  }
  // retry failed embeddings
  async retry_failed_files() {
    this.settings.failed_files = [];
    const failed_embeddings_file_exists = await this.app.vault.adapter.exists(".smart-connections/failed-embeddings.txt");
    if (failed_embeddings_file_exists) {
      await this.app.vault.adapter.remove(".smart-connections/failed-embeddings.txt");
    }
    await this.get_all_embeddings();
  }
  // add .smart-connections to .gitignore to prevent issues with large, frequently updated embeddings file(s)
  async add_to_gitignore() {
    if (!await this.app.vault.adapter.exists(".gitignore")) {
      return;
    }
    let gitignore_file = await this.app.vault.adapter.read(".gitignore");
    if (gitignore_file.indexOf(".smart-connections") < 0) {
      let add_to_gitignore = "\n\n# Ignore Smart Connections folder because embeddings file is large and updated frequently";
      add_to_gitignore += "\n.smart-connections";
      await this.app.vault.adapter.write(".gitignore", gitignore_file + add_to_gitignore);
      console.log("added .smart-connections to .gitignore");
    }
  }
  // force refresh embeddings file but first rename existing embeddings file to .smart-connections/embeddings-YYYY-MM-DD.json
  async force_refresh_embeddings_file() {
    new Obsidian.Notice("Smart Connections: \u94FE\u63A5\u6587\u4EF6\u5DF2\u5F3A\u5236\u5237\u65B0\uFF0C\u6B63\u5728\u521B\u5EFA\u65B0\u7684\u94FE\u63A5...");
    await this.smart_vec_lite.force_refresh();
    await this.get_all_embeddings();
    this.output_render_log();
    new Obsidian.Notice("Smart Connections: \u94FE\u63A5\u6587\u4EF6\u5F3A\u5236\u5237\u65B0\uFF0C\u65B0\u7684\u94FE\u63A5\u5DF2\u5EFA\u7ACB\u3002");
  }
  // get embeddings for embed_input
  async get_file_embeddings(curr_file, save = true) {
    let req_batch = [];
    let blocks = [];
    const curr_file_key = md5(curr_file.path);
    let file_embed_input = curr_file.path.replace(".md", "");
    file_embed_input = file_embed_input.replace(/\//g, " > ");
    let path_only = false;
    for (let j = 0; j < this.path_only.length; j++) {
      if (curr_file.path.indexOf(this.path_only[j]) > -1) {
        path_only = true;
        console.log("title only file with matcher: " + this.path_only[j]);
        break;
      }
    }
    if (path_only) {
      req_batch.push([curr_file_key, file_embed_input, {
        mtime: curr_file.stat.mtime,
        path: curr_file.path
      }]);
      await this.get_embeddings_batch(req_batch);
      return;
    }
    if (curr_file.extension === "canvas") {
      const canvas_contents = await this.app.vault.cachedRead(curr_file);
      if (typeof canvas_contents === "string" && canvas_contents.indexOf("nodes") > -1) {
        const canvas_json = JSON.parse(canvas_contents);
        for (let j = 0; j < canvas_json.nodes.length; j++) {
          if (canvas_json.nodes[j].text) {
            file_embed_input += "\n" + canvas_json.nodes[j].text;
          }
          if (canvas_json.nodes[j].file) {
            file_embed_input += "\nLink: " + canvas_json.nodes[j].file;
          }
        }
      }
      req_batch.push([curr_file_key, file_embed_input, {
        mtime: curr_file.stat.mtime,
        path: curr_file.path
      }]);
      await this.get_embeddings_batch(req_batch);
      return;
    }
    const note_contents = await this.app.vault.cachedRead(curr_file);
    let processed_since_last_save = 0;
    const note_sections = this.block_parser(note_contents, curr_file.path);
    if (note_sections.length > 1) {
      for (let j = 0; j < note_sections.length; j++) {
        const block_embed_input = note_sections[j].text;
        const block_key = md5(note_sections[j].path);
        blocks.push(block_key);
        if (this.smart_vec_lite.get_size(block_key) === block_embed_input.length) {
          continue;
        }
        if (this.smart_vec_lite.mtime_is_current(block_key, curr_file.stat.mtime)) {
          continue;
        }
        const block_hash = md5(block_embed_input.trim());
        if (this.smart_vec_lite.get_hash(block_key) === block_hash) {
          continue;
        }
        req_batch.push([block_key, block_embed_input, {
          // oldmtime: curr_file.stat.mtime, 
          // get current datetime as unix timestamp
          mtime: Date.now(),
          hash: block_hash,
          parent: curr_file_key,
          path: note_sections[j].path,
          size: block_embed_input.length
        }]);
        if (req_batch.length > 9) {
          await this.get_embeddings_batch(req_batch);
          processed_since_last_save += req_batch.length;
          if (processed_since_last_save >= 30) {
            await this.save_embeddings_to_file();
            processed_since_last_save = 0;
          }
          req_batch = [];
        }
      }
    }
    if (req_batch.length > 0) {
      await this.get_embeddings_batch(req_batch);
      req_batch = [];
      processed_since_last_save += req_batch.length;
    }
    file_embed_input += `:
`;
    if (note_contents.length < MAX_EMBED_STRING_LENGTH) {
      file_embed_input += note_contents;
    } else {
      const note_meta_cache = this.app.metadataCache.getFileCache(curr_file);
      if (typeof note_meta_cache.headings === "undefined") {
        file_embed_input += note_contents.substring(0, MAX_EMBED_STRING_LENGTH);
      } else {
        let note_headings = "";
        for (let j = 0; j < note_meta_cache.headings.length; j++) {
          const heading_level = note_meta_cache.headings[j].level;
          const heading_text = note_meta_cache.headings[j].heading;
          let md_heading = "";
          for (let k = 0; k < heading_level; k++) {
            md_heading += "#";
          }
          note_headings += `${md_heading} ${heading_text}
`;
        }
        file_embed_input += note_headings;
        if (file_embed_input.length > MAX_EMBED_STRING_LENGTH) {
          file_embed_input = file_embed_input.substring(0, MAX_EMBED_STRING_LENGTH);
        }
      }
    }
    const file_hash = md5(file_embed_input.trim());
    const existing_hash = this.smart_vec_lite.get_hash(curr_file_key);
    if (existing_hash && file_hash === existing_hash) {
      this.update_render_log(blocks, file_embed_input);
      return;
    }
    ;
    const existing_blocks = this.smart_vec_lite.get_children(curr_file_key);
    let existing_has_all_blocks = true;
    if (existing_blocks && Array.isArray(existing_blocks) && blocks.length > 0) {
      for (let j = 0; j < blocks.length; j++) {
        if (existing_blocks.indexOf(blocks[j]) === -1) {
          existing_has_all_blocks = false;
          break;
        }
      }
    }
    if (existing_has_all_blocks) {
      const curr_file_size = curr_file.stat.size;
      const prev_file_size = this.smart_vec_lite.get_size(curr_file_key);
      if (prev_file_size) {
        const file_delta_pct = Math.round(Math.abs(curr_file_size - prev_file_size) / curr_file_size * 100);
        if (file_delta_pct < 10) {
          this.render_log.skipped_low_delta[curr_file.name] = file_delta_pct + "%";
          this.update_render_log(blocks, file_embed_input);
          return;
        }
      }
    }
    let meta = {
      mtime: curr_file.stat.mtime,
      hash: file_hash,
      path: curr_file.path,
      size: curr_file.stat.size,
      children: blocks
    };
    req_batch.push([curr_file_key, file_embed_input, meta]);
    await this.get_embeddings_batch(req_batch);
    if (save) {
      await this.save_embeddings_to_file();
    }
  }
  update_render_log(blocks, file_embed_input) {
    if (blocks.length > 0) {
      this.render_log.tokens_saved_by_cache += file_embed_input.length / 2;
    } else {
      this.render_log.tokens_saved_by_cache += file_embed_input.length / 4;
    }
  }
  async get_embeddings_batch(req_batch) {
    console.log("get_embeddings_batch");
    if (req_batch.length === 0)
      return;
    const embed_inputs = req_batch.map((req) => req[1]);
    const requestResults = await this.request_embedding_from_input(embed_inputs);
    if (!requestResults) {
      console.log("failed embedding batch");
      this.render_log.failed_embeddings = [...this.render_log.failed_embeddings, ...req_batch.map((req) => req[2].path)];
      return;
    }
    if (requestResults) {
      this.has_new_embeddings = true;
      if (this.settings.log_render) {
        if (this.settings.log_render_files) {
          this.render_log.files = [...this.render_log.files, ...req_batch.map((req) => req[2].path)];
        }
        this.render_log.new_embeddings += req_batch.length;
        this.render_log.token_usage += requestResults.usage.total_tokens;
      }
      for (let i = 0; i < requestResults.data.length; i++) {
        const vec = requestResults.data[i].embedding;
        const index = requestResults.data[i].index;
        if (vec) {
          const key = req_batch[index][0];
          const meta = req_batch[index][2];
          this.smart_vec_lite.save_embedding(key, vec, meta);
        }
      }
    }
  }
  async request_embedding_from_input(embed_input, retries = 0) {
    if (embed_input.length === 0) {
      console.log("embed_input is empty");
      return null;
    }
    const usedParams = {
      model: "text-embedding-ada-002",
      input: embed_input
    };
    const reqParams = {
      url: `${this.settings.api_endpoint}/v1/embeddings`,
      method: "POST",
      body: JSON.stringify(usedParams),
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.settings.api_key}`
      }
    };
    let resp;
    try {
      resp = await (0, Obsidian.request)(reqParams);
      return JSON.parse(resp);
    } catch (error) {
      if (error.status === 429 && retries < 3) {
        retries++;
        const backoff = Math.pow(retries, 2);
        console.log(`retrying request (429) in ${backoff} seconds...`);
        await new Promise((r) => setTimeout(r, 1e3 * backoff));
        return await this.request_embedding_from_input(embed_input, retries);
      }
      console.log(resp);
      console.log(error);
      return null;
    }
  }
  async test_api_key() {
    const embed_input = "This is a test of the OpenAI API.";
    const resp = await this.request_embedding_from_input(embed_input);
    if (resp && resp.usage) {
      console.log("API key is valid");
      return true;
    } else {
      console.log("API key is invalid");
      return false;
    }
  }
  output_render_log() {
    if (this.settings.log_render) {
      if (this.render_log.new_embeddings === 0) {
        return;
      } else {
        console.log(JSON.stringify(this.render_log, null, 2));
      }
    }
    this.render_log = {};
    this.render_log.deleted_embeddings = 0;
    this.render_log.exclusions_logs = {};
    this.render_log.failed_embeddings = [];
    this.render_log.files = [];
    this.render_log.new_embeddings = 0;
    this.render_log.skipped_low_delta = {};
    this.render_log.token_usage = 0;
    this.render_log.tokens_saved_by_cache = 0;
  }
  // find connections by most similar to current note by cosine similarity
  async find_note_connections(current_note = null) {
    const curr_key = md5(current_note.path);
    let nearest = [];
    if (this.nearest_cache[curr_key]) {
      nearest = this.nearest_cache[curr_key];
    } else {
      for (let j = 0; j < this.file_exclusions.length; j++) {
        if (current_note.path.indexOf(this.file_exclusions[j]) > -1) {
          this.log_exclusion(this.file_exclusions[j]);
          return "\u5F53\u524D\u7B14\u8BB0\u5DF2\u88AB\u6392\u9664";
        }
      }
      setTimeout(() => {
        this.get_all_embeddings();
      }, 3e3);
      if (this.smart_vec_lite.mtime_is_current(curr_key, current_note.stat.mtime)) {
      } else {
        await this.get_file_embeddings(current_note);
      }
      const vec = this.smart_vec_lite.get_vec(curr_key);
      if (!vec) {
        return "\u83B7\u53D6\u5D4C\u5165\u5185\u5BB9\u65F6\u51FA\u9519\uFF1A " + current_note.path;
      }
      nearest = this.smart_vec_lite.nearest(vec, {
        skip_key: curr_key,
        skip_sections: this.settings.skip_sections
      });
      this.nearest_cache[curr_key] = nearest;
    }
    return nearest;
  }
  // create render_log object of exlusions with number of times skipped as value
  log_exclusion(exclusion) {
    this.render_log.exclusions_logs[exclusion] = (this.render_log.exclusions_logs[exclusion] || 0) + 1;
  }
  block_parser(markdown, file_path) {
    if (this.settings.skip_sections) {
      return [];
    }
    const lines = markdown.split("\n");
    let blocks = [];
    let currentHeaders = [];
    const file_breadcrumbs = file_path.replace(".md", "").replace(/\//g, " > ");
    let block = "";
    let block_headings = "";
    let block_path = file_path;
    let last_heading_line = 0;
    let i = 0;
    let block_headings_list = [];
    for (i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith("#") || ["#", " "].indexOf(line[1]) < 0) {
        if (line === "")
          continue;
        if (["- ", "- [ ] "].indexOf(line) > -1)
          continue;
        if (currentHeaders.length === 0)
          continue;
        block += "\n" + line;
        continue;
      }
      last_heading_line = i;
      if (i > 0 && last_heading_line !== i - 1 && block.indexOf("\n") > -1 && this.validate_headings(block_headings)) {
        output_block();
      }
      const level = line.split("#").length - 1;
      currentHeaders = currentHeaders.filter((header) => header.level < level);
      currentHeaders.push({ header: line.replace(/#/g, "").trim(), level });
      block = file_breadcrumbs;
      block += ": " + currentHeaders.map((header) => header.header).join(" > ");
      block_headings = "#" + currentHeaders.map((header) => header.header).join("#");
      if (block_headings_list.indexOf(block_headings) > -1) {
        let count = 1;
        while (block_headings_list.indexOf(`${block_headings}{${count}}`) > -1) {
          count++;
        }
        block_headings = `${block_headings}{${count}}`;
      }
      block_headings_list.push(block_headings);
      block_path = file_path + block_headings;
    }
    if (last_heading_line !== i - 1 && block.indexOf("\n") > -1 && this.validate_headings(block_headings))
      output_block();
    blocks = blocks.filter((b) => b.length > 50);
    return blocks;
    function output_block() {
      const breadcrumbs_length = block.indexOf("\n") + 1;
      const block_length = block.length - breadcrumbs_length;
      if (block.length > MAX_EMBED_STRING_LENGTH) {
        block = block.substring(0, MAX_EMBED_STRING_LENGTH);
      }
      blocks.push({ text: block.trim(), path: block_path, length: block_length });
    }
  }
  // reverse-retrieve block given path
  async block_retriever(path, limits = {}) {
    limits = {
      lines: null,
      chars_per_line: null,
      max_chars: null,
      ...limits
    };
    if (path.indexOf("#") < 0) {
      console.log("not a block path: " + path);
      return false;
    }
    let block = [];
    let block_headings = path.split("#").slice(1);
    let heading_occurrence = 0;
    if (block_headings[block_headings.length - 1].indexOf("{") > -1) {
      heading_occurrence = parseInt(block_headings[block_headings.length - 1].split("{")[1].replace("}", ""));
      block_headings[block_headings.length - 1] = block_headings[block_headings.length - 1].split("{")[0];
    }
    let currentHeaders = [];
    let occurrence_count = 0;
    let begin_line = 0;
    let i = 0;
    const file_path = path.split("#")[0];
    const file = this.app.vault.getAbstractFileByPath(file_path);
    if (!(file instanceof Obsidian.TFile)) {
      console.log("not a file: " + file_path);
      return false;
    }
    const file_contents = await this.app.vault.cachedRead(file);
    const lines = file_contents.split("\n");
    let is_code = false;
    for (i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.indexOf("```") === 0) {
        is_code = !is_code;
      }
      if (is_code) {
        continue;
      }
      if (["- ", "- [ ] "].indexOf(line) > -1)
        continue;
      if (!line.startsWith("#") || ["#", " "].indexOf(line[1]) < 0) {
        continue;
      }
      const heading_text = line.replace(/#/g, "").trim();
      const heading_index = block_headings.indexOf(heading_text);
      if (heading_index < 0)
        continue;
      if (currentHeaders.length !== heading_index)
        continue;
      currentHeaders.push(heading_text);
      if (currentHeaders.length === block_headings.length) {
        if (heading_occurrence === 0) {
          begin_line = i + 1;
          break;
        }
        if (occurrence_count === heading_occurrence) {
          begin_line = i + 1;
          break;
        }
        occurrence_count++;
        currentHeaders.pop();
        continue;
      }
    }
    if (begin_line === 0)
      return false;
    is_code = false;
    let char_count = 0;
    for (i = begin_line; i < lines.length; i++) {
      if (typeof line_limit === "number" && block.length > line_limit) {
        block.push("...");
        break;
      }
      let line = lines[i];
      if (line.indexOf("#") === 0 && ["#", " "].indexOf(line[1]) !== -1) {
        break;
      }
      if (limits.max_chars && char_count > limits.max_chars) {
        block.push("...");
        break;
      }
      if (limits.max_chars && line.length + char_count > limits.max_chars) {
        const max_new_chars = limits.max_chars - char_count;
        line = line.slice(0, max_new_chars) + "...";
        break;
      }
      if (line.length === 0)
        continue;
      if (limits.chars_per_line && line.length > limits.chars_per_line) {
        line = line.slice(0, limits.chars_per_line) + "...";
      }
      if (line.startsWith("```")) {
        is_code = !is_code;
        continue;
      }
      if (is_code) {
        line = "	" + line;
      }
      block.push(line);
      char_count += line.length;
    }
    if (is_code) {
      block.push("```");
    }
    return block.join("\n").trim();
  }
  // retrieve a file from the vault
  async file_retriever(link, limits = {}) {
    limits = {
      lines: null,
      max_chars: null,
      chars_per_line: null,
      ...limits
    };
    const this_file = this.app.vault.getAbstractFileByPath(link);
    if (!(this_file instanceof Obsidian.TAbstractFile))
      return false;
    const file_content = await this.app.vault.cachedRead(this_file);
    const file_lines = file_content.split("\n");
    let first_ten_lines = [];
    let is_code = false;
    let char_accum = 0;
    const line_limit2 = limits.lines || file_lines.length;
    for (let i = 0; first_ten_lines.length < line_limit2; i++) {
      let line = file_lines[i];
      if (typeof line === "undefined")
        break;
      if (line.length === 0)
        continue;
      if (limits.chars_per_line && line.length > limits.chars_per_line) {
        line = line.slice(0, limits.chars_per_line) + "...";
      }
      if (line === "---")
        continue;
      if (["- ", "- [ ] "].indexOf(line) > -1)
        continue;
      if (line.indexOf("```") === 0) {
        is_code = !is_code;
        continue;
      }
      if (limits.max_chars && char_accum > limits.max_chars) {
        first_ten_lines.push("...");
        break;
      }
      if (is_code) {
        line = "	" + line;
      }
      if (line_is_heading(line)) {
        if (first_ten_lines.length > 0 && line_is_heading(first_ten_lines[first_ten_lines.length - 1])) {
          first_ten_lines.pop();
        }
      }
      first_ten_lines.push(line);
      char_accum += line.length;
    }
    for (let i = 0; i < first_ten_lines.length; i++) {
      if (line_is_heading(first_ten_lines[i])) {
        if (i === first_ten_lines.length - 1) {
          first_ten_lines.pop();
          break;
        }
        first_ten_lines[i] = first_ten_lines[i].replace(/#+/, "");
        first_ten_lines[i] = `
${first_ten_lines[i]}:`;
      }
    }
    first_ten_lines = first_ten_lines.join("\n");
    return first_ten_lines;
  }
  // iterate through blocks and skip if block_headings contains this.header_exclusions
  validate_headings(block_headings) {
    let valid = true;
    if (this.header_exclusions.length > 0) {
      for (let k = 0; k < this.header_exclusions.length; k++) {
        if (block_headings.indexOf(this.header_exclusions[k]) > -1) {
          valid = false;
          this.log_exclusion("heading: " + this.header_exclusions[k]);
          break;
        }
      }
    }
    return valid;
  }
  // render "Smart Connections" text fixed in the bottom right corner
  render_brand(container, location = "default") {
    if (container === "all") {
      const locations = Object.keys(this.sc_branding);
      for (let i = 0; i < locations.length; i++) {
        this.render_brand(this.sc_branding[locations[i]], locations[i]);
      }
      return;
    }
    this.sc_branding[location] = container;
    if (this.sc_branding[location].querySelector(".sc-brand")) {
      this.sc_branding[location].querySelector(".sc-brand").remove();
    }
    const brand_container = this.sc_branding[location].createEl("div", { cls: "sc-brand" });
    Obsidian.setIcon(brand_container, "smart-connections");
    const brand_p = brand_container.createEl("p");
    let text = "Smart Connections";
    let attr = {};
    if (this.update_available) {
      text = "Update Available";
      attr = {
        style: "font-weight: 700;"
      };
    }
    brand_p.createEl("a", {
      cls: "",
      text,
      href: "https://github.com/brianpetro/obsidian-smart-connections/discussions",
      target: "_blank",
      attr
    });
  }
  // create list of nearest notes
  async update_results(container, nearest) {
    let list;
    if (container.children.length > 1 && container.children[1].classList.contains("sc-list")) {
      list = container.children[1];
    }
    if (list) {
      list.empty();
    } else {
      list = container.createEl("div", { cls: "sc-list" });
    }
    let search_result_class = "search-result";
    if (!this.settings.expanded_view)
      search_result_class += " sc-collapsed";
    if (!this.settings.group_nearest_by_file) {
      for (let i = 0; i < nearest.length; i++) {
        if (typeof nearest[i].link === "object") {
          const item2 = list.createEl("div", { cls: "search-result" });
          const link2 = item2.createEl("a", {
            cls: "search-result-file-title is-clickable",
            href: nearest[i].link.path,
            title: nearest[i].link.title
          });
          link2.innerHTML = this.render_external_link_elm(nearest[i].link);
          item2.setAttr("draggable", "true");
          continue;
        }
        let file_link_text;
        const file_similarity_pct = Math.round(nearest[i].similarity * 100) + "%";
        if (this.settings.show_full_path) {
          const pcs = nearest[i].link.split("/");
          file_link_text = pcs[pcs.length - 1];
          const path = pcs.slice(0, pcs.length - 1).join("/");
          file_link_text = `<small>${file_similarity_pct} | ${path} | ${file_link_text}</small>`;
        } else {
          file_link_text = "<small>" + file_similarity_pct + " | " + nearest[i].link.split("/").pop() + "</small>";
        }
        if (!this.renderable_file_type(nearest[i].link)) {
          const item2 = list.createEl("div", { cls: "search-result" });
          const link2 = item2.createEl("a", {
            cls: "search-result-file-title is-clickable",
            href: nearest[i].link
          });
          link2.innerHTML = file_link_text;
          item2.setAttr("draggable", "true");
          this.add_link_listeners(link2, nearest[i], item2);
          continue;
        }
        file_link_text = file_link_text.replace(".md", "").replace(/#/g, " > ");
        const item = list.createEl("div", { cls: search_result_class });
        const toggle = item.createEl("span", { cls: "is-clickable" });
        Obsidian.setIcon(toggle, "right-triangle");
        const link = toggle.createEl("a", {
          cls: "search-result-file-title",
          title: nearest[i].link
        });
        link.innerHTML = file_link_text;
        this.add_link_listeners(link, nearest[i], item);
        toggle.addEventListener("click", (event) => {
          let parent = event.target.parentElement;
          while (!parent.classList.contains("search-result")) {
            parent = parent.parentElement;
          }
          parent.classList.toggle("sc-collapsed");
        });
        const contents = item.createEl("ul", { cls: "" });
        const contents_container = contents.createEl("li", {
          cls: "search-result-file-title is-clickable",
          title: nearest[i].link
        });
        if (nearest[i].link.indexOf("#") > -1) {
          Obsidian.MarkdownRenderer.renderMarkdown(await this.block_retriever(nearest[i].link, { lines: 10, max_chars: 1e3 }), contents_container, nearest[i].link, new Obsidian.Component());
        } else {
          const first_ten_lines = await this.file_retriever(nearest[i].link, { lines: 10, max_chars: 1e3 });
          if (!first_ten_lines)
            continue;
          Obsidian.MarkdownRenderer.renderMarkdown(first_ten_lines, contents_container, nearest[i].link, new Obsidian.Component());
        }
        this.add_link_listeners(contents, nearest[i], item);
      }
      this.render_brand(container, "block");
      return;
    }
    const nearest_by_file = {};
    for (let i = 0; i < nearest.length; i++) {
      const curr = nearest[i];
      const link = curr.link;
      if (typeof link === "object") {
        nearest_by_file[link.path] = [curr];
        continue;
      }
      if (link.indexOf("#") > -1) {
        const file_path = link.split("#")[0];
        if (!nearest_by_file[file_path]) {
          nearest_by_file[file_path] = [];
        }
        nearest_by_file[file_path].push(nearest[i]);
      } else {
        if (!nearest_by_file[link]) {
          nearest_by_file[link] = [];
        }
        nearest_by_file[link].unshift(nearest[i]);
      }
    }
    const keys = Object.keys(nearest_by_file);
    for (let i = 0; i < keys.length; i++) {
      const file = nearest_by_file[keys[i]];
      if (typeof file[0].link === "object") {
        const curr = file[0];
        const meta = curr.link;
        if (meta.path.startsWith("http")) {
          const item2 = list.createEl("div", { cls: "search-result" });
          const link = item2.createEl("a", {
            cls: "search-result-file-title is-clickable",
            href: meta.path,
            title: meta.title
          });
          link.innerHTML = this.render_external_link_elm(meta);
          item2.setAttr("draggable", "true");
          continue;
        }
      }
      let file_link_text;
      const file_similarity_pct = Math.round(file[0].similarity * 100) + "%";
      if (this.settings.show_full_path) {
        const pcs = file[0].link.split("/");
        file_link_text = pcs[pcs.length - 1];
        const path = pcs.slice(0, pcs.length - 1).join("/");
        file_link_text = `<small>${path} | ${file_similarity_pct}</small><br>${file_link_text}`;
      } else {
        file_link_text = file[0].link.split("/").pop();
        file_link_text += " | " + file_similarity_pct;
      }
      if (!this.renderable_file_type(file[0].link)) {
        const item2 = list.createEl("div", { cls: "search-result" });
        const file_link2 = item2.createEl("a", {
          cls: "search-result-file-title is-clickable",
          title: file[0].link
        });
        file_link2.innerHTML = file_link_text;
        this.add_link_listeners(file_link2, file[0], item2);
        continue;
      }
      file_link_text = file_link_text.replace(".md", "").replace(/#/g, " > ");
      const item = list.createEl("div", { cls: search_result_class });
      const toggle = item.createEl("span", { cls: "is-clickable" });
      Obsidian.setIcon(toggle, "right-triangle");
      const file_link = toggle.createEl("a", {
        cls: "search-result-file-title",
        title: file[0].link
      });
      file_link.innerHTML = file_link_text;
      this.add_link_listeners(file_link, file[0], toggle);
      toggle.addEventListener("click", (event) => {
        let parent = event.target;
        while (!parent.classList.contains("search-result")) {
          parent = parent.parentElement;
        }
        parent.classList.toggle("sc-collapsed");
      });
      const file_link_list = item.createEl("ul");
      for (let j = 0; j < file.length; j++) {
        if (file[j].link.indexOf("#") > -1) {
          const block = file[j];
          const block_link = file_link_list.createEl("li", {
            cls: "search-result-file-title is-clickable",
            title: block.link
          });
          if (file.length > 1) {
            const block_context = this.render_block_context(block);
            const block_similarity_pct = Math.round(block.similarity * 100) + "%";
            block_link.innerHTML = `<small>${block_context} | ${block_similarity_pct}</small>`;
          }
          const block_container = block_link.createEl("div");
          Obsidian.MarkdownRenderer.renderMarkdown(await this.block_retriever(block.link, { lines: 10, max_chars: 1e3 }), block_container, block.link, new Obsidian.Component());
          this.add_link_listeners(block_link, block, file_link_list);
        } else {
          const file_link_list2 = item.createEl("ul");
          const block_link = file_link_list2.createEl("li", {
            cls: "search-result-file-title is-clickable",
            title: file[0].link
          });
          const block_container = block_link.createEl("div");
          let first_ten_lines = await this.file_retriever(file[0].link, { lines: 10, max_chars: 1e3 });
          if (!first_ten_lines)
            continue;
          Obsidian.MarkdownRenderer.renderMarkdown(first_ten_lines, block_container, file[0].link, new Obsidian.Component());
          this.add_link_listeners(block_link, file[0], file_link_list2);
        }
      }
    }
    this.render_brand(container, "file");
  }
  add_link_listeners(item, curr, list) {
    item.addEventListener("click", async (event) => {
      await this.open_note(curr, event);
    });
    item.setAttr("draggable", "true");
    item.addEventListener("dragstart", (event) => {
      const dragManager = this.app.dragManager;
      const file_path = curr.link.split("#")[0];
      const file = this.app.metadataCache.getFirstLinkpathDest(file_path, "");
      const dragData = dragManager.dragFile(event, file);
      dragManager.onDragStart(event, dragData);
    });
    if (curr.link.indexOf("{") > -1)
      return;
    item.addEventListener("mouseover", (event) => {
      this.app.workspace.trigger("hover-link", {
        event,
        source: SMART_CONNECTIONS_VIEW_TYPE,
        hoverParent: list,
        targetEl: item,
        linktext: curr.link
      });
    });
  }
  // get target file from link path
  // if sub-section is linked, open file and scroll to sub-section
  async open_note(curr, event = null) {
    let targetFile;
    let heading;
    if (curr.link.indexOf("#") > -1) {
      targetFile = this.app.metadataCache.getFirstLinkpathDest(curr.link.split("#")[0], "");
      const target_file_cache = this.app.metadataCache.getFileCache(targetFile);
      let heading_text = curr.link.split("#").pop();
      let occurence = 0;
      if (heading_text.indexOf("{") > -1) {
        occurence = parseInt(heading_text.split("{")[1].split("}")[0]);
        heading_text = heading_text.split("{")[0];
      }
      const headings = target_file_cache.headings;
      for (let i = 0; i < headings.length; i++) {
        if (headings[i].heading === heading_text) {
          if (occurence === 0) {
            heading = headings[i];
            break;
          }
          occurence--;
        }
      }
    } else {
      targetFile = this.app.metadataCache.getFirstLinkpathDest(curr.link, "");
    }
    let leaf;
    if (event) {
      const mod = Obsidian.Keymap.isModEvent(event);
      leaf = this.app.workspace.getLeaf(mod);
    } else {
      leaf = this.app.workspace.getMostRecentLeaf();
    }
    await leaf.openFile(targetFile);
    if (heading) {
      let { editor } = leaf.view;
      const pos = { line: heading.position.start.line, ch: 0 };
      editor.setCursor(pos);
      editor.scrollIntoView({ to: pos, from: pos }, true);
    }
  }
  render_block_context(block) {
    const block_headings = block.link.split(".md")[1].split("#");
    let block_context = "";
    for (let i = block_headings.length - 1; i >= 0; i--) {
      if (block_context.length > 0) {
        block_context = ` > ${block_context}`;
      }
      block_context = block_headings[i] + block_context;
      if (block_context.length > 100) {
        break;
      }
    }
    if (block_context.startsWith(" > ")) {
      block_context = block_context.slice(3);
    }
    return block_context;
  }
  renderable_file_type(link) {
    return link.indexOf(".md") !== -1 && link.indexOf(".excalidraw") === -1;
  }
  render_external_link_elm(meta) {
    if (meta.source) {
      if (meta.source === "Gmail")
        meta.source = "\u{1F4E7} Gmail";
      return `<small>${meta.source}</small><br>${meta.title}`;
    }
    let domain = meta.path.replace(/(^\w+:|^)\/\//, "");
    domain = domain.split("/")[0];
    return `<small>\u{1F310} ${domain}</small><br>${meta.title}`;
  }
  // get all folders
  async get_all_folders() {
    if (!this.folders || this.folders.length === 0) {
      this.folders = await this.get_folders();
    }
    return this.folders;
  }
  // get folders, traverse non-hidden sub-folders
  async get_folders(path = "/") {
    let folders = (await this.app.vault.adapter.list(path)).folders;
    let folder_list = [];
    for (let i = 0; i < folders.length; i++) {
      if (folders[i].startsWith("."))
        continue;
      folder_list.push(folders[i]);
      folder_list = folder_list.concat(await this.get_folders(folders[i] + "/"));
    }
    return folder_list;
  }
  async sync_notes() {
    if (!this.settings.license_key) {
      new Obsidian.Notice("Smart Connections: Supporter license key is required to sync notes to the ChatGPT Plugin server.");
      return;
    }
    console.log("syncing notes");
    const files = this.app.vault.getMarkdownFiles().filter((file) => {
      for (let i = 0; i < this.file_exclusions.length; i++) {
        if (file.path.indexOf(this.file_exclusions[i]) > -1) {
          return false;
        }
      }
      return true;
    });
    const notes = await this.build_notes_object(files);
    console.log("object built");
    await this.app.vault.adapter.write(".smart-connections/notes.json", JSON.stringify(notes, null, 2));
    console.log("notes saved");
    console.log(this.settings.license_key);
    const response = await (0, Obsidian.requestUrl)({
      url: "https://sync.smartconnections.app/sync",
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      contentType: "application/json",
      body: JSON.stringify({
        license_key: this.settings.license_key,
        notes
      })
    });
    console.log(response);
  }
  async build_notes_object(files) {
    let output = {};
    for (let i = 0; i < files.length; i++) {
      let file = files[i];
      let parts = file.path.split("/");
      let current = output;
      for (let ii = 0; ii < parts.length; ii++) {
        let part = parts[ii];
        if (ii === parts.length - 1) {
          current[part] = await this.app.vault.cachedRead(file);
        } else {
          if (!current[part]) {
            current[part] = {};
          }
          current = current[part];
        }
      }
    }
    return output;
  }
};
var SMART_CONNECTIONS_VIEW_TYPE = "smart-connections-view";
var SmartConnectionsView = class extends Obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.nearest = null;
    this.load_wait = null;
  }
  getViewType() {
    return SMART_CONNECTIONS_VIEW_TYPE;
  }
  getDisplayText() {
    return "Smart Connections Files";
  }
  getIcon() {
    return "smart-connections";
  }
  set_message(message) {
    const container = this.containerEl.children[1];
    container.empty();
    this.initiate_top_bar(container);
    if (Array.isArray(message)) {
      for (let i = 0; i < message.length; i++) {
        container.createEl("p", { cls: "sc_message", text: message[i] });
      }
    } else {
      container.createEl("p", { cls: "sc_message", text: message });
    }
  }
  render_link_text(link, show_full_path = false) {
    if (!show_full_path) {
      link = link.split("/").pop();
    }
    if (link.indexOf("#") > -1) {
      link = link.split(".md");
      link[0] = `<small>${link[0]}</small><br>`;
      link = link.join("");
      link = link.replace(/\#/g, " \xBB ");
    } else {
      link = link.replace(".md", "");
    }
    return link;
  }
  set_nearest(nearest, nearest_context = null, results_only = false) {
    const container = this.containerEl.children[1];
    if (!results_only) {
      container.empty();
      this.initiate_top_bar(container, nearest_context);
    }
    this.plugin.update_results(container, nearest);
  }
  initiate_top_bar(container, nearest_context = null) {
    let top_bar;
    if (container.children.length > 0 && container.children[0].classList.contains("sc-top-bar")) {
      top_bar = container.children[0];
      top_bar.empty();
    } else {
      top_bar = container.createEl("div", { cls: "sc-top-bar" });
    }
    if (nearest_context) {
      top_bar.createEl("p", { cls: "sc-context", text: nearest_context });
    }
    const chat_button = top_bar.createEl("button", { cls: "sc-chat-button" });
    Obsidian.setIcon(chat_button, "message-square");
    chat_button.addEventListener("click", () => {
      this.plugin.open_chat();
    });
    const search_button = top_bar.createEl("button", { cls: "sc-search-button" });
    Obsidian.setIcon(search_button, "search");
    search_button.addEventListener("click", () => {
      top_bar.empty();
      const search_container = top_bar.createEl("div", { cls: "search-input-container" });
      const input = search_container.createEl("input", {
        cls: "sc-search-input",
        type: "search",
        placeholder: "Type to start search..."
      });
      input.focus();
      input.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          this.clear_auto_searcher();
          this.initiate_top_bar(container, nearest_context);
        }
      });
      input.addEventListener("keyup", (event) => {
        this.clear_auto_searcher();
        const search_term = input.value;
        if (event.key === "Enter" && search_term !== "") {
          this.search(search_term);
        } else if (search_term !== "") {
          clearTimeout(this.search_timeout);
          this.search_timeout = setTimeout(() => {
            this.search(search_term, true);
          }, 700);
        }
      });
    });
  }
  // render buttons: "create" and "retry" for loading embeddings.json file
  render_embeddings_buttons() {
    const container = this.containerEl.children[1];
    container.empty();
    container.createEl("h2", { cls: "scHeading", text: "Embeddings file not found" });
    const button_div = container.createEl("div", { cls: "scButtonDiv" });
    const create_button = button_div.createEl("button", { cls: "scButton", text: "Create embeddings.json" });
    button_div.createEl("p", { cls: "scButtonNote", text: "Warning: Creating embeddings.json file will trigger bulk embedding and may take a while" });
    const retry_button = button_div.createEl("button", { cls: "scButton", text: "Retry" });
    button_div.createEl("p", { cls: "scButtonNote", text: "If embeddings.json file already exists, click 'Retry' to load it" });
    create_button.addEventListener("click", async (event) => {
      await this.plugin.smart_vec_lite.init_embeddings_file();
      await this.render_connections();
    });
    retry_button.addEventListener("click", async (event) => {
      console.log("retrying to load embeddings.json file");
      await this.plugin.init_vecs();
      await this.render_connections();
    });
  }
  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.createEl("p", { cls: "scPlaceholder", text: "Open a note to find connections." });
    this.plugin.registerEvent(this.app.workspace.on("file-open", (file) => {
      if (!file) {
        return;
      }
      if (SUPPORTED_FILE_TYPES.indexOf(file.extension) === -1) {
        return this.set_message([
          "File: " + file.name,
          "Unsupported file type (Supported: " + SUPPORTED_FILE_TYPES.join(", ") + ")"
        ]);
      }
      if (this.load_wait) {
        clearTimeout(this.load_wait);
      }
      this.load_wait = setTimeout(() => {
        this.render_connections(file);
        this.load_wait = null;
      }, 1e3);
    }));
    this.app.workspace.registerHoverLinkSource(SMART_CONNECTIONS_VIEW_TYPE, {
      display: "Smart Connections Files",
      defaultMod: true
    });
    this.app.workspace.registerHoverLinkSource(SMART_CONNECTIONS_CHAT_VIEW_TYPE, {
      display: "Smart Chat Links",
      defaultMod: true
    });
    this.app.workspace.onLayoutReady(this.initialize.bind(this));
  }
  async initialize() {
    this.set_message("\u6B63\u5728\u52A0\u8F7D\u5D4C\u5165\u6587\u4EF6...");
    const vecs_intiated = await this.plugin.init_vecs();
    if (vecs_intiated) {
      this.set_message("\u5D4C\u5165\u6587\u4EF6\u52A0\u8F7D\u5B8C\u6210");
      await this.render_connections();
    } else {
      this.render_embeddings_buttons();
    }
    this.api = new SmartConnectionsViewApi(this.app, this.plugin, this);
    (window["SmartConnectionsViewApi"] = this.api) && this.register(() => delete window["SmartConnectionsViewApi"]);
  }
  async onClose() {
    console.log("closing smart connections view");
    this.app.workspace.unregisterHoverLinkSource(SMART_CONNECTIONS_VIEW_TYPE);
    this.plugin.view = null;
  }
  async render_connections(context = null) {
    console.log("rendering connections");
    if (!this.plugin.settings.api_key) {
      this.set_message("\u6B63\u786E\u914D\u7F6E OpenAI API \u4FE1\u606F\u540E\u65B9\u53EF\u4F7F\u7528 Smart Connections");
      return;
    }
    if (!this.plugin.embeddings_loaded) {
      await this.plugin.init_vecs();
    }
    if (!this.plugin.embeddings_loaded) {
      console.log("\u5D4C\u5165\u6587\u4EF6\u5C1A\u672A\u52A0\u8F7D\u6216\u5C1A\u672A\u521B\u5EFA");
      this.render_embeddings_buttons();
      return;
    }
    this.set_message("\u6B63\u5728\u521B\u5EFA\u667A\u80FD\u8FDE\u63A5...");
    if (typeof context === "string") {
      const highlighted_text = context;
      await this.search(highlighted_text);
      return;
    }
    this.nearest = null;
    this.interval_count = 0;
    this.rendering = false;
    this.file = context;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.interval = setInterval(() => {
      if (!this.rendering) {
        if (this.file instanceof Obsidian.TFile) {
          this.rendering = true;
          this.render_note_connections(this.file);
        } else {
          this.file = this.app.workspace.getActiveFile();
          if (!this.file && this.count > 1) {
            clearInterval(this.interval);
            this.set_message("\u65E0\u6D3B\u52A8\u6587\u4EF6");
            return;
          }
        }
      } else {
        if (this.nearest) {
          clearInterval(this.interval);
          if (typeof this.nearest === "string") {
            this.set_message(this.nearest);
          } else {
            this.set_nearest(this.nearest, "File: " + this.file.name);
          }
          if (this.plugin.render_log.failed_embeddings.length > 0) {
            this.plugin.save_failed_embeddings();
          }
          this.plugin.output_render_log();
          return;
        } else {
          this.interval_count++;
          this.set_message("\u6B63\u5728\u521B\u5EFA\u667A\u80FD\u8FDE\u63A5..." + this.interval_count);
        }
      }
    }, 10);
  }
  async render_note_connections(file) {
    this.nearest = await this.plugin.find_note_connections(file);
  }
  clear_auto_searcher() {
    if (this.search_timeout) {
      clearTimeout(this.search_timeout);
      this.search_timeout = null;
    }
  }
  async search(search_text, results_only = false) {
    const nearest = await this.plugin.api.search(search_text);
    const nearest_context = `Selection: "${search_text.length > 100 ? search_text.substring(0, 100) + "..." : search_text}"`;
    this.set_nearest(nearest, nearest_context, results_only);
  }
};
var SmartConnectionsViewApi = class {
  constructor(app, plugin, view) {
    this.app = app;
    this.plugin = plugin;
    this.view = view;
  }
  async search(search_text) {
    return await this.plugin.api.search(search_text);
  }
  // trigger reload of embeddings file
  async reload_embeddings_file() {
    await this.plugin.init_vecs();
    await this.view.render_connections();
  }
};
var ScSearchApi = class {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
  }
  async search(search_text, filter = {}) {
    filter = {
      skip_sections: this.plugin.settings.skip_sections,
      ...filter
    };
    let nearest = [];
    const resp = await this.plugin.request_embedding_from_input(search_text);
    if (resp && resp.data && resp.data[0] && resp.data[0].embedding) {
      nearest = this.plugin.smart_vec_lite.nearest(resp.data[0].embedding, filter);
    } else {
      new Obsidian.Notice("Smart Connections: Error getting embedding");
    }
    return nearest;
  }
};
var SmartConnectionsSettingsTab = class extends Obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const {
      containerEl
    } = this;
    containerEl.empty();
    new Obsidian.Setting(containerEl).setName("\u7248\u672C\u66F4\u65B0").setDesc("\u66F4\u65B0\u5230\u6700\u65B0\u7248\u672C\uFF0C\u4EE5\u83B7\u53D6\u66F4\u591A\u529F\u80FD").addButton((button) => button.setButtonText("\u66F4\u65B0").onClick(async () => {
      await this.plugin.upgrade();
    }));
    new Obsidian.Setting(containerEl).setName("\u540C\u6B65\u7B14\u8BB0").setDesc("\u901A\u8FC7 Smart Connections \u670D\u52A1\u5668\u540C\u6B65\u7B14\u8BB0\u3002\u652F\u6301\u4E0B\u9762\u914D\u7F6E\u7684\u6392\u9664\u8BBE\u7F6E\u3002").addButton((button) => button.setButtonText("\u540C\u6B65\u7B14\u8BB0").onClick(async () => {
      await this.plugin.sync_notes();
    }));
    new Obsidian.Setting(containerEl).setName("\u652F\u6301 Smart Connections \u4E2D\u6587\u7248").setDesc("\u652F\u6301\u4E00\u4E0B\u5427").addButton((button) => button.setButtonText("\u652F\u6301(\u5FAE\u4FE1\u6536\u6B3E\u7801)").onClick(async () => {
      const payment_pages = [
        "https://mir.ug0.ltd/static/image/wechatpay.png"
      ];
      if (!this.plugin.payment_page_index) {
        this.plugin.payment_page_index = Math.round(Math.random());
      }
      window.open(payment_pages[this.plugin.payment_page_index]);
    }));
    containerEl.createEl("h2", {
      text: "\u6A21\u578B\u8BBE\u7F6E"
    });
    new Obsidian.Setting(containerEl).setName("\u8BBE\u7F6E OpenAI API \u5BC6\u94A5").setDesc("\u5FC5\u586B: \u4F7F\u7528\u672C\u63D2\u4EF6\u5FC5\u987B\u586B\u5199\u6B64\u5B57\u6BB5").addText((text) => text.setPlaceholder("\u8F93\u5165 OpenAI API key").setValue(this.plugin.settings.api_key).onChange(async (value) => {
      this.plugin.settings.api_key = value.trim();
      await this.plugin.saveSettings(true);
    }));
    new Obsidian.Setting(containerEl).setName("\u8BBE\u7F6E OpenAI API \u63A5\u5165\u5730\u5740").setDesc("\u53EF\u9009\uFF1A\u5982\u679C OpenAI API \u53EF\u7528\u6027\u6D4B\u8BD5\u5931\u8D25\uFF0C\u5EFA\u8BAE\u66F4\u6362\u5176\u4ED6\u63A5\u5165\u5730\u5740").addText((text) => text.setPlaceholder("\u8F93\u5165 OpenAI API \u63A5\u5165\u5730\u5740").setValue(this.plugin.settings.api_endpoint).onChange(async (value) => {
      this.plugin.settings.api_endpoint = value.trim();
      await this.plugin.saveSettings(true);
    }));
    new Obsidian.Setting(containerEl).setName("\u6D4B\u8BD5 OpenAI API \u53EF\u7528\u6027").setDesc("\u6D4B\u8BD5 OpenAI API \u53EF\u7528\u6027").addButton((button) => button.setButtonText("\u6D4B\u8BD5").onClick(async () => {
      const resp = await this.plugin.test_api_key();
      if (resp) {
        new Obsidian.Notice("Smart Connections: OpenAI API \u6709\u6548\uFF01");
      } else {
        new Obsidian.Notice("Smart Connections: OpenAI API \u65E0\u6CD5\u4F7F\u7528\uFF01");
      }
    }));
    new Obsidian.Setting(containerEl).setName("\u5BF9\u8BDD\u6A21\u578B").setDesc("\u9009\u62E9\u7528\u4E8E\u5BF9\u8BDD\u7684\u6A21\u578B").addDropdown((dropdown) => {
      dropdown.addOption("gpt-3.5-turbo-16k", "gpt-3.5-turbo-16k");
      dropdown.addOption("gpt-4", "gpt-4 (8k)");
      dropdown.addOption("gpt-3.5-turbo", "gpt-3.5-turbo (4k)");
      dropdown.addOption("gpt-4-1106-preview", "gpt-4-turbo (128k)");
      dropdown.onChange(async (value) => {
        this.plugin.settings.smart_chat_model = value;
        await this.plugin.saveSettings();
      });
      dropdown.setValue(this.plugin.settings.smart_chat_model);
    });
    containerEl.createEl("h2", {
      text: "\u6392\u9664"
    });
    new Obsidian.Setting(containerEl).setName("\u6392\u9664\u6587\u4EF6").setDesc("\u8F93\u5165\u9700\u8981\u6392\u9664\u7684\u6587\u4EF6\u540D\uFF0C\u7528\u9017\u53F7\u5206\u9694\u6587\u4EF6").addText((text) => text.setPlaceholder("drawings,prompts/logs").setValue(this.plugin.settings.file_exclusions).onChange(async (value) => {
      this.plugin.settings.file_exclusions = value;
      await this.plugin.saveSettings();
    }));
    new Obsidian.Setting(containerEl).setName("\u6392\u9664\u6587\u4EF6\u5939").setDesc("\u8F93\u5165\u9700\u8981\u6392\u9664\u7684\u6587\u4EF6\u5939\u540D\uFF0C\u7528\u9017\u53F7\u5206\u9694\u591A\u4E2A\u6587\u4EF6\u5939").addText((text) => text.setPlaceholder("drawings,prompts/logs").setValue(this.plugin.settings.folder_exclusions).onChange(async (value) => {
      this.plugin.settings.folder_exclusions = value;
      await this.plugin.saveSettings();
    }));
    new Obsidian.Setting(containerEl).setName("\u4EC5\u4F7F\u7528\u67D0\u4E2A\u8DEF\u5F84").setDesc("\u8F93\u5165\u9700\u8981\u4F7F\u7528\u7684\u8DEF\u5F84\uFF0C\u7528\u9017\u53F7\u5206\u9694\u591A\u4E2A\u8DEF\u5F84").addText((text) => text.setPlaceholder("drawings,prompts/logs").setValue(this.plugin.settings.path_only).onChange(async (value) => {
      this.plugin.settings.path_only = value;
      await this.plugin.saveSettings();
    }));
    new Obsidian.Setting(containerEl).setName("\u6392\u9664\u6807\u9898").setDesc("\u8F93\u5165\u9700\u8981\u6392\u9664\u7684\u6807\u9898\uFF0C\u7528\u9017\u53F7\u5206\u9694\u591A\u4E2A\u6807\u9898(\u53EA\u9002\u7528\u4E8E\u533A\u5757)").addText((text) => text.setPlaceholder("drawings,prompts/logs").setValue(this.plugin.settings.header_exclusions).onChange(async (value) => {
      this.plugin.settings.header_exclusions = value;
      await this.plugin.saveSettings();
    }));
    containerEl.createEl("h2", {
      text: "\u663E\u793A\u8BBE\u7F6E"
    });
    new Obsidian.Setting(containerEl).setName("\u663E\u793A\u5B8C\u6574\u8DEF\u5F84").setDesc("\u5728\u89C6\u56FE\u4E2D\u663E\u793A\u5173\u8054\u7B14\u8BB0\u7684\u5B8C\u6574\u8DEF\u5F84").addToggle((toggle) => toggle.setValue(this.plugin.settings.show_full_path).onChange(async (value) => {
      this.plugin.settings.show_full_path = value;
      await this.plugin.saveSettings(true);
    }));
    new Obsidian.Setting(containerEl).setName("\u5C55\u5F00\u7B14\u8BB0").setDesc("\u9ED8\u8BA4\u5C55\u5F00\u5173\u8054\u7B14\u8BB0\u7684\u5185\u5BB9").addToggle((toggle) => toggle.setValue(this.plugin.settings.expanded_view).onChange(async (value) => {
      this.plugin.settings.expanded_view = value;
      await this.plugin.saveSettings(true);
    }));
    new Obsidian.Setting(containerEl).setName("\u6309\u6587\u4EF6\u68C0\u7D22\u5173\u8054\u5EA6").setDesc("\u6309\u6587\u4EF6\u68C0\u7D22\u5173\u8054\u5EA6\uFF08\u5173\u95ED\u540E\u6309\u6807\u9898\u68C0\u7D22\u5173\u8054\u5EA6\uFF09").addToggle((toggle) => toggle.setValue(this.plugin.settings.group_nearest_by_file).onChange(async (value) => {
      this.plugin.settings.group_nearest_by_file = value;
      await this.plugin.saveSettings(true);
    }));
    new Obsidian.Setting(containerEl).setName("\u81EA\u52A8\u6253\u5F00\u5173\u7CFB\u89C6\u56FE").setDesc("Open view on Obsidian startup.").addToggle((toggle) => toggle.setValue(this.plugin.settings.view_open).onChange(async (value) => {
      this.plugin.settings.view_open = value;
      await this.plugin.saveSettings(true);
    }));
    new Obsidian.Setting(containerEl).setName("\u81EA\u52A8\u6253\u5F00\u5BF9\u8BDD\u7A97\u53E3").setDesc("\u542F\u52A8 Obsidian \u65F6\u81EA\u52A8\u6253\u5F00\u5BF9\u8BDD\u7A97\u53E3").addToggle((toggle) => toggle.setValue(this.plugin.settings.chat_open).onChange(async (value) => {
      this.plugin.settings.chat_open = value;
      await this.plugin.saveSettings(true);
    }));
    containerEl.createEl("h2", {
      text: "\u9AD8\u7EA7\u8BBE\u7F6E"
    });
    new Obsidian.Setting(containerEl).setName("\u65E5\u5FD7\u6E32\u67D3").setDesc("\u5C06\u6E32\u67D3\u8BE6\u7EC6\u4FE1\u606F\u8BB0\u5F55\u5230\u63A7\u5236\u53F0(\u5305\u62ECtoken\u4F7F\u7528\u91CF)").addToggle((toggle) => toggle.setValue(this.plugin.settings.log_render).onChange(async (value) => {
      this.plugin.settings.log_render = value;
      await this.plugin.saveSettings(true);
    }));
    new Obsidian.Setting(containerEl).setName("\u8BB0\u5F55\u6E32\u67D3\u6587\u4EF6").setDesc("\u4F7F\u7528\u65E5\u5FD7\u6E32\u67D3\u8BB0\u5F55\u5D4C\u5165\u5F0F\u5BF9\u8C61\u7684\u8DEF\u5F84(\u7528\u4E8E\u8C03\u8BD5)").addToggle((toggle) => toggle.setValue(this.plugin.settings.log_render_files).onChange(async (value) => {
      this.plugin.settings.log_render_files = value;
      await this.plugin.saveSettings(true);
    }));
    new Obsidian.Setting(containerEl).setName("\u8DF3\u8FC7\u7279\u5B9A\u90E8\u5206").setDesc("\u8DF3\u8FC7\u5BF9\u7B14\u8BB0\u4E2D\u7684\u7279\u5B9A\u90E8\u5206\u5EFA\u7ACB\u8FDE\u63A5\u3002\u8B66\u544A\uFF1A\u6709\u5927\u6587\u4EF6\u65F6\u4F1A\u964D\u4F4E\u4F7F\u7528\u6548\u7387\uFF0C\u672A\u6765\u4F7F\u7528\u65F6\u9700\u8981\u201C\u5F3A\u5236\u5237\u65B0\u201D\u3002").addToggle((toggle) => toggle.setValue(this.plugin.settings.skip_sections).onChange(async (value) => {
      this.plugin.settings.skip_sections = value;
      await this.plugin.saveSettings(true);
    }));
    containerEl.createEl("h3", {
      text: "\u6D4B\u8BD5\u6587\u4EF6\u5199\u5165"
    });
    containerEl.createEl("h3", {
      text: "\u624B\u52A8\u4FDD\u5B58"
    });
    let manual_save_results = containerEl.createEl("div");
    new Obsidian.Setting(containerEl).setName("\u624B\u52A8\u4FDD\u5B58").setDesc("\u4FDD\u5B58\u5F53\u524D\u5DF2\u5D4C\u5165\u7684\u5185\u5BB9").addButton((button) => button.setButtonText("\u624B\u52A8\u4FDD\u5B58").onClick(async () => {
      if (confirm("\u4F60\u786E\u5B9A\u8981\u4FDD\u5B58\u5F53\u524D\u5DF2\u5D4C\u5165\u7684\u5185\u5BB9\u5417\uFF1F")) {
        try {
          await this.plugin.save_embeddings_to_file(true);
          manual_save_results.innerHTML = "\u5D4C\u5165\u5185\u5BB9\u4FDD\u5B58\u6210\u529F\u3002";
        } catch (e) {
          manual_save_results.innerHTML = "\u5D4C\u5165\u5185\u5BB9\u4FDD\u5B58\u5931\u8D25\u3002\u9519\u8BEF\uFF1A" + e;
        }
      }
    }));
    containerEl.createEl("h3", {
      text: "Previously failed files"
    });
    let failed_list = containerEl.createEl("div");
    this.draw_failed_files_list(failed_list);
    containerEl.createEl("h3", {
      text: "\u5F3A\u5236\u5237\u65B0"
    });
    new Obsidian.Setting(containerEl).setName("\u5F3A\u5236\u5237\u65B0").setDesc("\u8B66\u544A\uFF1A\u9664\u975E\u4F60\u77E5\u9053\u81EA\u5DF1\u5728\u505A\u4EC0\u4E48\uFF0C\u5426\u5219\u4E0D\u8981\u4F7F\u7528\uFF01\u8FD9\u5C06\u5220\u9664\u6570\u636E\u5E93\u4E2D\u6240\u6709\u5DF2\u5D4C\u5165\u7684\u5185\u5BB9\uFF0C\u5E76\u91CD\u65B0\u751F\u6210\u6574\u4E2A\u6570\u636E\u5E93\uFF01").addButton((button) => button.setButtonText("Force Refresh").onClick(async () => {
      if (confirm("\u786E\u5B9A\u8981\u5F3A\u5236\u5237\u65B0\u5417\uFF1F\u70B9\u51FB\u201C\u786E\u5B9A\u201D\u8868\u793A\u60A8\u7406\u89E3\u8FD9\u4E2A\u64CD\u4F5C\u5E26\u6765\u7684\u540E\u679C\u3002")) {
        await this.plugin.force_refresh_embeddings_file();
      }
    }));
  }
  draw_failed_files_list(failed_list) {
    failed_list.empty();
    if (this.plugin.settings.failed_files.length > 0) {
      failed_list.createEl("p", {
        text: "\u4EE5\u4E0B\u6587\u4EF6\u5904\u7406\u5931\u8D25\uFF0C\u5C06\u88AB\u8DF3\u8FC7\uFF0C\u76F4\u5230\u624B\u52A8\u91CD\u8BD5\u3002"
      });
      let list = failed_list.createEl("ul");
      for (let failed_file of this.plugin.settings.failed_files) {
        list.createEl("li", {
          text: failed_file
        });
      }
      new Obsidian.Setting(failed_list).setName("\u4EC5\u91CD\u8BD5\u5931\u8D25\u6587\u4EF6").setDesc("\u4EC5\u91CD\u8BD5\u5931\u8D25\u6587\u4EF6").addButton((button) => button.setButtonText("\u4EC5\u91CD\u8BD5\u5931\u8D25\u6587\u4EF6").onClick(async () => {
        failed_list.empty();
        failed_list.createEl("p", {
          text: "\u6B63\u5728\u91CD\u8BD5..."
        });
        await this.plugin.retry_failed_files();
        this.draw_failed_files_list(failed_list);
      }));
    } else {
      failed_list.createEl("p", {
        text: "\u65E0\u5904\u7406\u5931\u8D25\u7684\u6587\u4EF6"
      });
    }
  }
};
function line_is_heading(line) {
  return line.indexOf("#") === 0 && ["#", " "].indexOf(line[1]) !== -1;
}
var SMART_CONNECTIONS_CHAT_VIEW_TYPE = "smart-connections-chat-view";
var SmartConnectionsChatView = class extends Obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.active_elm = null;
    this.active_stream = null;
    this.brackets_ct = 0;
    this.chat = null;
    this.chat_box = null;
    this.chat_container = null;
    this.current_chat_ml = [];
    this.files = [];
    this.last_from = null;
    this.message_container = null;
    this.prevent_input = false;
  }
  getDisplayText() {
    return "Smart Connections Chat";
  }
  getIcon() {
    return "message-square";
  }
  getViewType() {
    return SMART_CONNECTIONS_CHAT_VIEW_TYPE;
  }
  onOpen() {
    this.new_chat();
    this.plugin.get_all_folders();
  }
  onClose() {
    this.chat.save_chat();
    this.app.workspace.unregisterHoverLinkSource(SMART_CONNECTIONS_CHAT_VIEW_TYPE);
  }
  render_chat() {
    this.containerEl.empty();
    this.chat_container = this.containerEl.createDiv("sc-chat-container");
    this.render_top_bar();
    this.render_chat_box();
    this.render_chat_input();
    this.plugin.render_brand(this.containerEl, "chat");
  }
  // render plus sign for clear button
  render_top_bar() {
    let top_bar_container = this.chat_container.createDiv("sc-top-bar-container");
    let chat_name = this.chat.name();
    let chat_name_input = top_bar_container.createEl("input", {
      attr: {
        type: "text",
        value: chat_name
      },
      cls: "sc-chat-name-input"
    });
    chat_name_input.addEventListener("change", this.rename_chat.bind(this));
    let smart_view_btn = this.create_top_bar_button(top_bar_container, "Smart View", "smart-connections");
    smart_view_btn.addEventListener("click", this.open_smart_view.bind(this));
    let save_btn = this.create_top_bar_button(top_bar_container, "Save Chat", "save");
    save_btn.addEventListener("click", this.save_chat.bind(this));
    let history_btn = this.create_top_bar_button(top_bar_container, "Chat History", "history");
    history_btn.addEventListener("click", this.open_chat_history.bind(this));
    const new_chat_btn = this.create_top_bar_button(top_bar_container, "New Chat", "plus");
    new_chat_btn.addEventListener("click", this.new_chat.bind(this));
  }
  async open_chat_history() {
    const folder = await this.app.vault.adapter.list(".smart-connections/chats");
    this.files = folder.files.map((file) => {
      return file.replace(".smart-connections/chats/", "").replace(".json", "");
    });
    if (!this.modal)
      this.modal = new SmartConnectionsChatHistoryModal(this.app, this);
    this.modal.open();
  }
  create_top_bar_button(top_bar_container, title, icon = null) {
    let btn = top_bar_container.createEl("button", {
      attr: {
        title
      }
    });
    if (icon) {
      Obsidian.setIcon(btn, icon);
    } else {
      btn.innerHTML = title;
    }
    return btn;
  }
  // render new chat
  new_chat() {
    this.clear_chat();
    this.render_chat();
    this.new_messsage_bubble("assistant");
    this.active_elm.innerHTML = "<p>" + SMART_TRANSLATION[this.plugin.settings.language].initial_message + "</p>";
  }
  // open a chat from the chat history modal
  async open_chat(chat_id) {
    this.clear_chat();
    await this.chat.load_chat(chat_id);
    this.render_chat();
    for (let i = 0; i < this.chat.chat_ml.length; i++) {
      await this.render_message(this.chat.chat_ml[i].content, this.chat.chat_ml[i].role);
    }
  }
  // clear current chat state
  clear_chat() {
    if (this.chat) {
      this.chat.save_chat();
    }
    this.chat = new SmartConnectionsChatModel(this.plugin);
    if (this.dotdotdot_interval) {
      clearInterval(this.dotdotdot_interval);
    }
    this.current_chat_ml = [];
    this.end_stream();
  }
  rename_chat(event) {
    let new_chat_name = event.target.value;
    this.chat.rename_chat(new_chat_name);
  }
  // save current chat
  save_chat() {
    this.chat.save_chat();
    new Obsidian.Notice("[Smart Connections] Chat saved");
  }
  open_smart_view() {
    this.plugin.open_view();
  }
  // render chat messages container
  render_chat_box() {
    this.chat_box = this.chat_container.createDiv("sc-chat-box");
    this.message_container = this.chat_box.createDiv("sc-message-container");
  }
  // open file suggestion modal
  open_file_suggestion_modal() {
    if (!this.file_selector)
      this.file_selector = new SmartConnectionsFileSelectModal(this.app, this);
    this.file_selector.open();
  }
  // open folder suggestion modal
  async open_folder_suggestion_modal() {
    if (!this.folder_selector) {
      this.folder_selector = new SmartConnectionsFolderSelectModal(this.app, this);
    }
    this.folder_selector.open();
  }
  // insert_selection from file suggestion modal
  insert_selection(insert_text) {
    let caret_pos = this.textarea.selectionStart;
    let text_before = this.textarea.value.substring(0, caret_pos);
    let text_after = this.textarea.value.substring(caret_pos, this.textarea.value.length);
    this.textarea.value = text_before + insert_text + text_after;
    this.textarea.selectionStart = caret_pos + insert_text.length;
    this.textarea.selectionEnd = caret_pos + insert_text.length;
    this.textarea.focus();
  }
  // render chat textarea and button
  render_chat_input() {
    let chat_input = this.chat_container.createDiv("sc-chat-form");
    this.textarea = chat_input.createEl("textarea", {
      cls: "sc-chat-input",
      attr: {
        placeholder: `\u4F7F\u7528 \u201C\u57FA\u4E8E\u6211\u7684\u7B14\u8BB0\u201D \u6216 \u201C\u603B\u7ED3 [[Obsidian \u94FE\u63A5]]\u201D \u6216 "\u544A\u8BC9\u6211 /\u76EE\u5F55/ \u4E2D\u6709\u4EC0\u4E48\u91CD\u8981\u4FE1\u606F"`
      }
    });
    chat_input.addEventListener("keyup", (e) => {
      if (["[", "/"].indexOf(e.key) === -1)
        return;
      const caret_pos = this.textarea.selectionStart;
      if (e.key === "[") {
        if (this.textarea.value[caret_pos - 2] === "[") {
          this.open_file_suggestion_modal();
          return;
        }
      } else {
        this.brackets_ct = 0;
      }
      if (e.key === "/") {
        if (this.textarea.value.length === 1 || this.textarea.value[caret_pos - 2] === " ") {
          this.open_folder_suggestion_modal();
          return;
        }
      }
    });
    chat_input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        if (this.prevent_input) {
          console.log("wait until current response is finished");
          new Obsidian.Notice("[Smart Connections] Wait until current response is finished");
          return;
        }
        let user_input = this.textarea.value;
        this.textarea.value = "";
        this.initialize_response(user_input);
      }
      this.textarea.style.height = "auto";
      this.textarea.style.height = this.textarea.scrollHeight + "px";
    });
    let button_container = chat_input.createDiv("sc-button-container");
    let abort_button = button_container.createEl("span", { attr: { id: "sc-abort-button", style: "display: none;" } });
    Obsidian.setIcon(abort_button, "square");
    abort_button.addEventListener("click", () => {
      this.end_stream();
    });
    let button = button_container.createEl("button", { attr: { id: "sc-send-button" }, cls: "send-button" });
    button.innerHTML = "\u53D1\u9001";
    button.addEventListener("click", () => {
      if (this.prevent_input) {
        console.log("wait until current response is finished");
        new Obsidian.Notice("\u8BF7\u7B49\u5F85\u5F53\u524D\u56DE\u590D\u7ED3\u675F");
        return;
      }
      let user_input = this.textarea.value;
      this.textarea.value = "";
      this.initialize_response(user_input);
    });
  }
  async initialize_response(user_input) {
    this.set_streaming_ux();
    await this.render_message(user_input, "user");
    this.chat.new_message_in_thread({
      role: "user",
      content: user_input
    });
    await this.render_dotdotdot();
    if (this.chat.contains_internal_link(user_input)) {
      this.chat.get_response_with_note_context(user_input, this);
      return;
    }
    if (this.contains_self_referential_keywords(user_input) || this.chat.contains_folder_reference(user_input)) {
      const context = await this.get_context_hyde(user_input);
      const chatml = [
        {
          role: "system",
          // content: context_input
          content: context
        },
        {
          role: "user",
          content: user_input
        }
      ];
      this.request_chatgpt_completion({ messages: chatml, temperature: 0, privacyStr: "\u5DF2\u7ECF\u8BFB\u53D6\u7B14\u8BB0\u5185\u5BB9" });
      return;
    }
    this.request_chatgpt_completion();
  }
  async render_dotdotdot() {
    if (this.dotdotdot_interval)
      clearInterval(this.dotdotdot_interval);
    await this.render_message("...", "assistant");
    let dots = 0;
    this.active_elm.innerHTML = "...";
    this.dotdotdot_interval = setInterval(() => {
      dots++;
      if (dots > 3)
        dots = 1;
      this.active_elm.innerHTML = ".".repeat(dots);
    }, 500);
  }
  set_streaming_ux() {
    this.prevent_input = true;
    if (document.getElementById("sc-send-button"))
      document.getElementById("sc-send-button").style.display = "none";
    if (document.getElementById("sc-abort-button"))
      document.getElementById("sc-abort-button").style.display = "block";
  }
  unset_streaming_ux() {
    this.prevent_input = false;
    if (document.getElementById("sc-send-button"))
      document.getElementById("sc-send-button").style.display = "";
    if (document.getElementById("sc-abort-button"))
      document.getElementById("sc-abort-button").style.display = "none";
  }
  // check if includes keywords referring to one's own notes
  contains_self_referential_keywords(user_input) {
    const matches = user_input.match(/基于\s*我的\s*笔记/);
    return !!matches;
  }
  // render message
  async render_message(message, from = "assistant", append_last = false, privacyStr = "") {
    if (this.dotdotdot_interval) {
      clearInterval(this.dotdotdot_interval);
      this.dotdotdot_interval = null;
      this.active_elm.innerHTML = "";
    }
    if (append_last) {
      this.current_message_raw += message;
      if (message.indexOf("\n") === -1) {
        this.active_elm.innerHTML += message;
      } else {
        this.active_elm.innerHTML = "";
        await Obsidian.MarkdownRenderer.renderMarkdown(this.current_message_raw, this.active_elm, "?no-dataview", new Obsidian.Component());
      }
    } else {
      this.current_message_raw = "";
      if (this.chat.thread.length === 0 || this.last_from !== from) {
        this.new_messsage_bubble(from);
      }
      this.active_elm.innerHTML = "";
      if (from === "assistant" && privacyStr !== "") {
        this.active_elm.innerHTML = `[${privacyStr}]`;
      }
      await Obsidian.MarkdownRenderer.renderMarkdown(message, this.active_elm, "?no-dataview", new Obsidian.Component());
      this.handle_links_in_message();
      this.render_message_action_buttons(message);
    }
    this.message_container.scrollTop = this.message_container.scrollHeight;
  }
  render_message_action_buttons(message) {
    if (this.chat.context && this.chat.hyd) {
      const context_view = this.active_elm.createEl("span", {
        cls: "sc-msg-button",
        attr: {
          title: "Copy context to clipboard"
          /* tooltip */
        }
      });
      const this_hyd = this.chat.hyd;
      Obsidian.setIcon(context_view, "eye");
      context_view.addEventListener("click", () => {
        navigator.clipboard.writeText("```smart-connections\n" + this_hyd + "\n```\n");
        new Obsidian.Notice("[Smart Connections] \u4E0A\u4E0B\u6587\u4EE3\u7801\u5757\u5DF2\u7ECF\u590D\u5236\u5230\u526A\u8D34\u677F");
      });
    }
    if (this.chat.context) {
      const copy_prompt_button = this.active_elm.createEl("span", {
        cls: "sc-msg-button",
        attr: {
          title: "Copy prompt to clipboard"
          /* tooltip */
        }
      });
      const this_context = this.chat.context.replace(/\`\`\`/g, "	```").trimLeft();
      Obsidian.setIcon(copy_prompt_button, "files");
      copy_prompt_button.addEventListener("click", () => {
        navigator.clipboard.writeText("```prompt-context\n" + this_context + "\n```\n");
        new Obsidian.Notice("[Smart Connections] \u4E0A\u4E0B\u6587\u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F");
      });
    }
    const copy_button = this.active_elm.createEl("span", {
      cls: "sc-msg-button",
      attr: {
        title: "Copy message to clipboard"
        /* tooltip */
      }
    });
    Obsidian.setIcon(copy_button, "copy");
    copy_button.addEventListener("click", () => {
      navigator.clipboard.writeText(message.trimLeft());
      new Obsidian.Notice("[Smart Connections] Message copied to clipboard");
    });
  }
  handle_links_in_message() {
    const links = this.active_elm.querySelectorAll("a");
    if (links.length > 0) {
      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        const link_text = link.getAttribute("data-href");
        link.addEventListener("mouseover", (event) => {
          this.app.workspace.trigger("hover-link", {
            event,
            source: SMART_CONNECTIONS_CHAT_VIEW_TYPE,
            hoverParent: link.parentElement,
            targetEl: link,
            // extract link text from a.data-href
            linktext: link_text
          });
        });
        link.addEventListener("click", (event) => {
          const link_tfile = this.app.metadataCache.getFirstLinkpathDest(link_text, "/");
          const mod = Obsidian.Keymap.isModEvent(event);
          let leaf = this.app.workspace.getLeaf(mod);
          leaf.openFile(link_tfile);
        });
      }
    }
  }
  new_messsage_bubble(from) {
    let message_el = this.message_container.createDiv(`sc-message ${from}`);
    this.active_elm = message_el.createDiv("sc-message-content");
    this.last_from = from;
  }
  async request_chatgpt_completion(opts = {}) {
    const chat_ml = opts.messages || opts.chat_ml || this.chat.prepare_chat_ml();
    console.log("chat_ml", chat_ml);
    const max_total_tokens = Math.round(get_max_chars(this.plugin.settings.smart_chat_model) / 4);
    console.log("max_total_tokens", max_total_tokens);
    const curr_token_est = Math.round(JSON.stringify(chat_ml).length / 3);
    console.log("curr_token_est", curr_token_est);
    let max_available_tokens = max_total_tokens - curr_token_est;
    if (max_available_tokens < 0)
      max_available_tokens = 200;
    else if (max_available_tokens > 4096)
      max_available_tokens = 4096;
    console.log("max_available_tokens", max_available_tokens);
    opts = {
      model: this.plugin.settings.smart_chat_model,
      messages: chat_ml,
      // max_tokens: 250,
      max_tokens: max_available_tokens,
      temperature: 0.3,
      top_p: 1,
      presence_penalty: 0,
      frequency_penalty: 0,
      stream: true,
      stop: null,
      n: 1,
      // logit_bias: logit_bias,
      ...opts
    };
    let privacyStr = opts.privacyStr || "";
    delete opts.privacyStr;
    if (opts.stream) {
      const full_str = await new Promise((resolve, reject) => {
        try {
          const url = `${this.plugin.settings.api_endpoint}/v1/chat/completions`;
          this.active_stream = new ScStreamer(url, {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.plugin.settings.api_key}`
            },
            method: "POST",
            payload: JSON.stringify(opts)
          });
          let txt = "";
          this.active_stream.addEventListener("message", (e) => {
            if (e.data != "[DONE]") {
              let resp = null;
              try {
                resp = JSON.parse(e.data);
                const text = resp.choices[0].delta.content;
                if (!text)
                  return;
                txt += text;
                this.render_message(text, "assistant", true, privacyStr);
              } catch (err) {
                if (e.data.indexOf("}{") > -1)
                  e.data = e.data.replace(/}{/g, "},{");
                resp = JSON.parse(`[${e.data}]`);
                resp.forEach((r) => {
                  const text = r.choices[0].delta.content;
                  if (!text)
                    return;
                  txt += text;
                  this.render_message(text, "assistant", true, privacyStr);
                });
              }
            } else {
              this.end_stream();
              resolve(txt);
            }
          });
          this.active_stream.addEventListener("readystatechange", (e) => {
            if (e.readyState >= 2) {
              console.log("ReadyState: " + e.readyState);
            }
          });
          this.active_stream.addEventListener("error", (e) => {
            console.error(e);
            new Obsidian.Notice("Smart Connections \u8FDB\u884C\u6D41\u5F0F\u8FDE\u63A5\u7684\u8FC7\u7A0B\u51FA\u73B0\u9519\u8BEF\u3002\u8BF7\u67E5\u770B\u8C03\u8BD5\u63A7\u5236\u53F0\u3002");
            this.render_message("*API \u8BF7\u6C42\u9519\u8BEF. \u8BF7\u67E5\u770B\u8C03\u8BD5\u63A7\u5236\u53F0.*", "assistant", false, privacyStr);
            this.end_stream();
            reject(e);
          });
          this.active_stream.stream();
        } catch (err) {
          console.error(err);
          new Obsidian.Notice("Smart Connections \u8FDB\u884C\u6D41\u5F0F\u8FDE\u63A5\u7684\u8FC7\u7A0B\u51FA\u73B0\u9519\u8BEF\u3002\u8BF7\u67E5\u770B\u8C03\u8BD5\u63A7\u5236\u53F0\u3002");
          this.end_stream();
          reject(err);
        }
      });
      await this.render_message(full_str, "assistant", false, privacyStr);
      this.chat.new_message_in_thread({
        role: "assistant",
        content: full_str
      });
      return;
    } else {
      try {
        const response = await (0, Obsidian.requestUrl)({
          url: `${this.plugin.settings.api_endpoint}/v1/chat/completions`,
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.plugin.settings.api_key}`,
            "Content-Type": "application/json"
          },
          contentType: "application/json",
          body: JSON.stringify(opts),
          throw: false
        });
        return JSON.parse(response.text).choices[0].message.content;
      } catch (err) {
        new Obsidian.Notice(`Smart Connections API \u8C03\u7528\u9519\u8BEF :: ${err}`);
      }
    }
  }
  end_stream() {
    if (this.active_stream) {
      this.active_stream.close();
      this.active_stream = null;
    }
    this.unset_streaming_ux();
    if (this.dotdotdot_interval) {
      clearInterval(this.dotdotdot_interval);
      this.dotdotdot_interval = null;
      this.active_elm.parentElement.remove();
      this.active_elm = null;
    }
  }
  async get_context_hyde(user_input) {
    this.chat.reset_context();
    const hyd_input = `Anticipate what the user is seeking. Respond in the form of a hypothetical note written by the user. The note may contain statements as paragraphs, lists, or checklists in markdown format with no headings. Please respond with one hypothetical note and abstain from any other commentary. Use the format: PARENT FOLDER NAME > CHILD FOLDER NAME > FILE NAME > HEADING 1 > HEADING 2 > HEADING 3: HYPOTHETICAL NOTE CONTENTS.`;
    const chatml = [
      {
        role: "system",
        content: hyd_input
      },
      {
        role: "user",
        content: user_input
      }
    ];
    const hyd = await this.request_chatgpt_completion({
      messages: chatml,
      stream: false,
      temperature: 0,
      max_tokens: 137
    });
    this.chat.hyd = hyd;
    let filter = {};
    if (this.chat.contains_folder_reference(user_input)) {
      const folder_refs = this.chat.get_folder_references(user_input);
      if (folder_refs) {
        filter = {
          path_begins_with: folder_refs
        };
      }
    }
    let nearest = await this.plugin.api.search(hyd, filter);
    console.log("nearest", nearest.length);
    nearest = this.get_nearest_until_next_dev_exceeds_std_dev(nearest);
    console.log("nearest after std dev slice", nearest.length);
    nearest = this.sort_by_len_adjusted_similarity(nearest);
    return await this.get_context_for_prompt(nearest);
  }
  sort_by_len_adjusted_similarity(nearest) {
    nearest = nearest.sort((a, b) => {
      const a_score = a.similarity / a.len;
      const b_score = b.similarity / b.len;
      if (a_score > b_score)
        return -1;
      if (a_score < b_score)
        return 1;
      return 0;
    });
    return nearest;
  }
  get_nearest_until_next_dev_exceeds_std_dev(nearest) {
    const sim = nearest.map((n) => n.similarity);
    const mean = sim.reduce((a, b) => a + b) / sim.length;
    let std_dev = Math.sqrt(sim.map((x) => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / sim.length);
    let slice_i = 0;
    while (slice_i < nearest.length) {
      const next = nearest[slice_i + 1];
      if (next) {
        const next_dev = Math.abs(next.similarity - nearest[slice_i].similarity);
        if (next_dev > std_dev) {
          if (slice_i < 3)
            std_dev = std_dev * 1.5;
          else
            break;
        }
      }
      slice_i++;
    }
    nearest = nearest.slice(0, slice_i + 1);
    return nearest;
  }
  // this.test_get_nearest_until_next_dev_exceeds_std_dev();
  // // test get_nearest_until_next_dev_exceeds_std_dev
  // test_get_nearest_until_next_dev_exceeds_std_dev() {
  //   const nearest = [{similarity: 0.99}, {similarity: 0.98}, {similarity: 0.97}, {similarity: 0.96}, {similarity: 0.95}, {similarity: 0.94}, {similarity: 0.93}, {similarity: 0.92}, {similarity: 0.91}, {similarity: 0.9}, {similarity: 0.79}, {similarity: 0.78}, {similarity: 0.77}, {similarity: 0.76}, {similarity: 0.75}, {similarity: 0.74}, {similarity: 0.73}, {similarity: 0.72}];
  //   const result = this.get_nearest_until_next_dev_exceeds_std_dev(nearest);
  //   if(result.length !== 10){
  //     console.error("get_nearest_until_next_dev_exceeds_std_dev failed", result);
  //   }
  // }
  async get_context_for_prompt(nearest) {
    let context = [];
    const MAX_SOURCES = this.plugin.settings.smart_chat_model === "gpt-4-1106-preview" ? 42 : 20;
    const MAX_CHARS = get_max_chars(this.plugin.settings.smart_chat_model) / 2;
    let char_accum = 0;
    for (let i = 0; i < nearest.length; i++) {
      if (context.length >= MAX_SOURCES)
        break;
      if (char_accum >= MAX_CHARS)
        break;
      if (typeof nearest[i].link !== "string")
        continue;
      const breadcrumbs = nearest[i].link.replace(/#/g, " > ").replace(".md", "").replace(/\//g, " > ");
      let new_context = `${breadcrumbs}:
`;
      const max_available_chars = MAX_CHARS - char_accum - new_context.length;
      if (nearest[i].link.indexOf("#") !== -1) {
        new_context += await this.plugin.block_retriever(nearest[i].link, { max_chars: max_available_chars });
      } else {
        new_context += await this.plugin.file_retriever(nearest[i].link, { max_chars: max_available_chars });
      }
      char_accum += new_context.length;
      context.push({
        link: nearest[i].link,
        text: new_context
      });
    }
    console.log("context sources: " + context.length);
    console.log("total context tokens: ~" + Math.round(char_accum / 3.5));
    this.chat.context = `Anticipate the type of answer desired by the user. Imagine the following ${context.length} notes were written by the user and contain all the necessary information to answer the user's question. Begin responses with "${SMART_TRANSLATION[this.plugin.settings.language].prompt}..."`;
    for (let i = 0; i < context.length; i++) {
      this.chat.context += `
---BEGIN #${i + 1}---
${context[i].text}
---END #${i + 1}---`;
    }
    return this.chat.context;
  }
};
function get_max_chars(model = "gpt-3.5-turbo") {
  const MAX_CHAR_MAP = {
    "gpt-3.5-turbo-16k": 48e3,
    "gpt-4": 24e3,
    "gpt-3.5-turbo": 12e3,
    "gpt-4-1106-preview": 2e5
  };
  return MAX_CHAR_MAP[model];
}
var SmartConnectionsChatModel = class {
  constructor(plugin) {
    this.app = plugin.app;
    this.plugin = plugin;
    this.chat_id = null;
    this.chat_ml = [];
    this.context = null;
    this.hyd = null;
    this.thread = [];
  }
  async save_chat() {
    if (this.thread.length === 0)
      return;
    if (!await this.app.vault.adapter.exists(".smart-connections/chats")) {
      await this.app.vault.adapter.mkdir(".smart-connections/chats");
    }
    if (!this.chat_id) {
      this.chat_id = this.name() + "\u2014" + this.get_file_date_string();
    }
    if (!this.chat_id.match(/^[a-zA-Z0-9_—\- ]+$/)) {
      console.log("Invalid chat_id: " + this.chat_id);
      new Obsidian.Notice("[Smart Connections] \u4FDD\u5B58\u5931\u8D25. \u975E\u6CD5\u4F1A\u8BDD id (chat_id): '" + this.chat_id + "'");
    }
    const chat_file = this.chat_id + ".json";
    this.app.vault.adapter.write(
      ".smart-connections/chats/" + chat_file,
      JSON.stringify(this.thread, null, 2)
    );
  }
  async load_chat(chat_id) {
    this.chat_id = chat_id;
    const chat_file = this.chat_id + ".json";
    let chat_json = await this.app.vault.adapter.read(
      ".smart-connections/chats/" + chat_file
    );
    this.thread = JSON.parse(chat_json);
    this.chat_ml = this.prepare_chat_ml();
  }
  // prepare chat_ml from chat
  // gets the last message of each turn unless turn_variation_offsets=[[turn_index,variation_index]] is specified in offset
  prepare_chat_ml(turn_variation_offsets = []) {
    if (turn_variation_offsets.length === 0) {
      this.chat_ml = this.thread.map((turn) => {
        return turn[turn.length - 1];
      });
    } else {
      let turn_variation_index = [];
      for (let i = 0; i < turn_variation_offsets.length; i++) {
        turn_variation_index[turn_variation_offsets[i][0]] = turn_variation_offsets[i][1];
      }
      this.chat_ml = this.thread.map((turn, turn_index) => {
        if (turn_variation_index[turn_index] !== void 0) {
          return turn[turn_variation_index[turn_index]];
        }
        return turn[turn.length - 1];
      });
    }
    this.chat_ml = this.chat_ml.map((message) => {
      return {
        role: message.role,
        content: message.content
      };
    });
    return this.chat_ml;
  }
  last() {
    return this.thread[this.thread.length - 1][this.thread[this.thread.length - 1].length - 1];
  }
  last_from() {
    return this.last().role;
  }
  // returns user_input or completion
  last_message() {
    return this.last().content;
  }
  // message={}
  // add new message to thread
  new_message_in_thread(message, turn = -1) {
    if (this.context) {
      message.context = this.context;
      this.context = null;
    }
    if (this.hyd) {
      message.hyd = this.hyd;
      this.hyd = null;
    }
    if (turn === -1) {
      this.thread.push([message]);
    } else {
      this.thread[turn].push(message);
    }
  }
  reset_context() {
    this.context = null;
    this.hyd = null;
  }
  async rename_chat(new_name) {
    if (this.chat_id && await this.app.vault.adapter.exists(".smart-connections/chats/" + this.chat_id + ".json")) {
      new_name = this.chat_id.replace(this.name(), new_name);
      await this.app.vault.adapter.rename(
        ".smart-connections/chats/" + this.chat_id + ".json",
        ".smart-connections/chats/" + new_name + ".json"
      );
      this.chat_id = new_name;
    } else {
      this.chat_id = new_name + "\u2014" + this.get_file_date_string();
      await this.save_chat();
    }
  }
  name() {
    if (this.chat_id) {
      return this.chat_id.replace(/—[^—]*$/, "");
    }
    return "UNTITLED";
  }
  get_file_date_string() {
    return (/* @__PURE__ */ new Date()).toISOString().replace(/(T|:|\..*)/g, " ").trim();
  }
  // get response from with note context
  async get_response_with_note_context(user_input, chat_view) {
    let system_input = "Imagine the following notes were written by the user and contain the necessary information to synthesize a useful answer the user's query:\n";
    const notes = this.extract_internal_links(user_input);
    let max_chars = get_max_chars(this.plugin.settings.smart_chat_model);
    for (let i = 0; i < notes.length; i++) {
      const this_max_chars = notes.length - i > 1 ? Math.floor(max_chars / (notes.length - i)) : max_chars;
      const note_content = await this.get_note_contents(notes[i], { char_limit: this_max_chars });
      system_input += `---BEGIN NOTE: [[${notes[i].basename}]]---
`;
      system_input += note_content;
      system_input += `---END NOTE---
`;
      max_chars -= note_content.length;
      if (max_chars <= 0)
        break;
    }
    this.context = system_input;
    const chatml = [
      {
        role: "system",
        content: system_input
      },
      {
        role: "user",
        content: user_input
      }
    ];
    chat_view.request_chatgpt_completion({ messages: chatml, temperature: 0, privacyStr: "\u5DF2\u7ECF\u8BFB\u53D6\u7B14\u8BB0\u5185\u5BB9" });
  }
  // check if contains internal link
  contains_internal_link(user_input) {
    if (user_input.indexOf("[[") === -1)
      return false;
    if (user_input.indexOf("]]") === -1)
      return false;
    return true;
  }
  // check if contains folder reference (ex. /folder/, or /folder/subfolder/)
  contains_folder_reference(user_input) {
    if (user_input.indexOf("/") === -1)
      return false;
    if (user_input.indexOf("/") === user_input.lastIndexOf("/"))
      return false;
    return true;
  }
  // get folder references from user input
  get_folder_references(user_input) {
    const folders = this.plugin.folders.slice();
    const matches = folders.sort((a, b) => b.length - a.length).map((folder) => {
      if (user_input.indexOf(folder) !== -1) {
        user_input = user_input.replace(folder, "");
        return folder;
      }
      return false;
    }).filter((folder) => folder);
    console.log(matches);
    if (matches)
      return matches;
    return false;
  }
  // extract internal links
  extract_internal_links(user_input) {
    const matches = user_input.match(/\[\[(.*?)\]\]/g);
    console.log(matches);
    if (matches)
      return matches.map((match) => {
        return this.app.metadataCache.getFirstLinkpathDest(match.replace("[[", "").replace("]]", ""), "/");
      });
    return [];
  }
  // get context from internal links
  async get_note_contents(note, opts = {}) {
    opts = {
      char_limit: 1e4,
      ...opts
    };
    if (!(note instanceof Obsidian.TFile))
      return "";
    let file_content = await this.app.vault.cachedRead(note);
    if (file_content.indexOf("```dataview") > -1) {
      file_content = await this.render_dataview_queries(file_content, note.path, opts);
    }
    file_content = file_content.substring(0, opts.char_limit);
    return file_content;
  }
  async render_dataview_queries(file_content, note_path, opts = {}) {
    opts = {
      char_limit: null,
      ...opts
    };
    const dataview_api = window["DataviewAPI"];
    if (!dataview_api)
      return file_content;
    const dataview_code_blocks = file_content.match(/```dataview(.*?)```/gs);
    for (let i = 0; i < dataview_code_blocks.length; i++) {
      if (opts.char_limit && opts.char_limit < file_content.indexOf(dataview_code_blocks[i]))
        break;
      const dataview_code_block = dataview_code_blocks[i];
      const dataview_code_block_content = dataview_code_block.replace("```dataview", "").replace("```", "");
      const dataview_query_result = await dataview_api.queryMarkdown(dataview_code_block_content, note_path, null);
      if (dataview_query_result.successful) {
        file_content = file_content.replace(dataview_code_block, dataview_query_result.value);
      }
    }
    return file_content;
  }
};
var SmartConnectionsChatHistoryModal = class extends Obsidian.FuzzySuggestModal {
  constructor(app, view, files) {
    super(app);
    this.app = app;
    this.view = view;
    this.setPlaceholder("Type the name of a chat session...");
  }
  getItems() {
    if (!this.view.files) {
      return [];
    }
    return this.view.files;
  }
  getItemText(item) {
    if (item.indexOf("UNTITLED") === -1) {
      item.replace(/—[^—]*$/, "");
    }
    return item;
  }
  onChooseItem(session) {
    this.view.open_chat(session);
  }
};
var SmartConnectionsFileSelectModal = class extends Obsidian.FuzzySuggestModal {
  constructor(app, view) {
    super(app);
    this.app = app;
    this.view = view;
    this.setPlaceholder("Type the name of a file...");
  }
  getItems() {
    return this.app.vault.getMarkdownFiles().sort((a, b) => a.basename.localeCompare(b.basename));
  }
  getItemText(item) {
    return item.basename;
  }
  onChooseItem(file) {
    this.view.insert_selection(file.basename + "]] ");
  }
};
var SmartConnectionsFolderSelectModal = class extends Obsidian.FuzzySuggestModal {
  constructor(app, view) {
    super(app);
    this.app = app;
    this.view = view;
    this.setPlaceholder("Type the name of a folder...");
  }
  getItems() {
    return this.view.plugin.folders;
  }
  getItemText(item) {
    return item;
  }
  onChooseItem(folder) {
    this.view.insert_selection(folder + "/ ");
  }
};
var ScStreamer = class {
  // constructor
  constructor(url, options) {
    options = options || {};
    this.url = url;
    this.method = options.method || "GET";
    this.headers = options.headers || {};
    this.payload = options.payload || null;
    this.withCredentials = options.withCredentials || false;
    this.listeners = {};
    this.readyState = this.CONNECTING;
    this.progress = 0;
    this.chunk = "";
    this.xhr = null;
    this.FIELD_SEPARATOR = ":";
    this.INITIALIZING = -1;
    this.CONNECTING = 0;
    this.OPEN = 1;
    this.CLOSED = 2;
  }
  // addEventListener
  addEventListener(type, listener) {
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }
    if (this.listeners[type].indexOf(listener) === -1) {
      this.listeners[type].push(listener);
    }
  }
  // removeEventListener
  removeEventListener(type, listener) {
    if (!this.listeners[type]) {
      return;
    }
    let filtered = [];
    for (let i = 0; i < this.listeners[type].length; i++) {
      if (this.listeners[type][i] !== listener) {
        filtered.push(this.listeners[type][i]);
      }
    }
    if (this.listeners[type].length === 0) {
      delete this.listeners[type];
    } else {
      this.listeners[type] = filtered;
    }
  }
  // dispatchEvent
  dispatchEvent(event) {
    if (!event) {
      return true;
    }
    event.source = this;
    let onHandler = "on" + event.type;
    if (this.hasOwnProperty(onHandler)) {
      this[onHandler].call(this, event);
      if (event.defaultPrevented) {
        return false;
      }
    }
    if (this.listeners[event.type]) {
      return this.listeners[event.type].every(function(callback) {
        callback(event);
        return !event.defaultPrevented;
      });
    }
    return true;
  }
  // _setReadyState
  _setReadyState(state) {
    let event = new CustomEvent("readyStateChange");
    event.readyState = state;
    this.readyState = state;
    this.dispatchEvent(event);
  }
  // _onStreamFailure
  _onStreamFailure(e) {
    let event = new CustomEvent("error");
    event.data = e.currentTarget.response;
    this.dispatchEvent(event);
    this.close();
  }
  // _onStreamAbort
  _onStreamAbort(e) {
    let event = new CustomEvent("abort");
    this.close();
  }
  // _onStreamProgress
  _onStreamProgress(e) {
    if (!this.xhr) {
      return;
    }
    if (this.xhr.status !== 200) {
      this._onStreamFailure(e);
      return;
    }
    if (this.readyState === this.CONNECTING) {
      this.dispatchEvent(new CustomEvent("open"));
      this._setReadyState(this.OPEN);
    }
    let data = this.xhr.responseText.substring(this.progress);
    this.progress += data.length;
    data.split(/(\r\n|\r|\n){2}/g).forEach(function(part) {
      if (part.trim().length === 0) {
        this.dispatchEvent(this._parseEventChunk(this.chunk.trim()));
        this.chunk = "";
      } else {
        this.chunk += part;
      }
    }.bind(this));
  }
  // _onStreamLoaded
  _onStreamLoaded(e) {
    this._onStreamProgress(e);
    this.dispatchEvent(this._parseEventChunk(this.chunk));
    this.chunk = "";
  }
  // _parseEventChunk
  _parseEventChunk(chunk) {
    if (!chunk || chunk.length === 0) {
      return null;
    }
    let e = { id: null, retry: null, data: "", event: "message" };
    chunk.split(/(\r\n|\r|\n)/).forEach(function(line) {
      line = line.trimRight();
      let index = line.indexOf(this.FIELD_SEPARATOR);
      if (index <= 0) {
        return;
      }
      let field = line.substring(0, index);
      if (!(field in e)) {
        return;
      }
      let value = line.substring(index + 1).trimLeft();
      if (field === "data") {
        e[field] += value;
      } else {
        e[field] = value;
      }
    }.bind(this));
    let event = new CustomEvent(e.event);
    event.data = e.data;
    event.id = e.id;
    return event;
  }
  // _checkStreamClosed
  _checkStreamClosed() {
    if (!this.xhr) {
      return;
    }
    if (this.xhr.readyState === XMLHttpRequest.DONE) {
      this._setReadyState(this.CLOSED);
    }
  }
  // stream
  stream() {
    this._setReadyState(this.CONNECTING);
    this.xhr = new XMLHttpRequest();
    this.xhr.addEventListener("progress", this._onStreamProgress.bind(this));
    this.xhr.addEventListener("load", this._onStreamLoaded.bind(this));
    this.xhr.addEventListener("readystatechange", this._checkStreamClosed.bind(this));
    this.xhr.addEventListener("error", this._onStreamFailure.bind(this));
    this.xhr.addEventListener("abort", this._onStreamAbort.bind(this));
    this.xhr.open(this.method, this.url);
    for (let header in this.headers) {
      this.xhr.setRequestHeader(header, this.headers[header]);
    }
    this.xhr.withCredentials = this.withCredentials;
    this.xhr.send(this.payload);
  }
  // close
  close() {
    if (this.readyState === this.CLOSED) {
      return;
    }
    this.xhr.abort();
    this.xhr = null;
    this._setReadyState(this.CLOSED);
  }
};
module.exports = SmartConnectionsPlugin;
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2luZGV4LmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJjb25zdCBPYnNpZGlhbiA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcclxuXHJcbmNvbnN0IERFRkFVTFRfU0VUVElOR1MgPSB7XHJcbiAgYXBpX2tleTogXCJcIixcclxuICBhcGlfZW5kcG9pbnQ6IFwiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbVwiLFxyXG4gIGNoYXRfb3BlbjogdHJ1ZSxcclxuICBmaWxlX2V4Y2x1c2lvbnM6IFwiXCIsXHJcbiAgZm9sZGVyX2V4Y2x1c2lvbnM6IFwiXCIsXHJcbiAgaGVhZGVyX2V4Y2x1c2lvbnM6IFwiXCIsXHJcbiAgcGF0aF9vbmx5OiBcIlwiLFxyXG4gIHNob3dfZnVsbF9wYXRoOiBmYWxzZSxcclxuICBleHBhbmRlZF92aWV3OiB0cnVlLFxyXG4gIGdyb3VwX25lYXJlc3RfYnlfZmlsZTogZmFsc2UsXHJcbiAgbGFuZ3VhZ2U6IFwiemhcIixcclxuICBsb2dfcmVuZGVyOiBmYWxzZSxcclxuICBsb2dfcmVuZGVyX2ZpbGVzOiBmYWxzZSxcclxuICByZWNlbnRseV9zZW50X3JldHJ5X25vdGljZTogZmFsc2UsXHJcbiAgc2tpcF9zZWN0aW9uczogZmFsc2UsXHJcbiAgc21hcnRfY2hhdF9tb2RlbDogXCJncHQtMy41LXR1cmJvLTE2a1wiLFxyXG4gIHZpZXdfb3BlbjogdHJ1ZSxcclxuICB2ZXJzaW9uOiBcIlwiLFxyXG59O1xyXG5jb25zdCBNQVhfRU1CRURfU1RSSU5HX0xFTkdUSCA9IDI1MDAwO1xyXG5cclxubGV0IFZFUlNJT047XHJcbmNvbnN0IFNVUFBPUlRFRF9GSUxFX1RZUEVTID0gW1wibWRcIiwgXCJjYW52YXNcIl07XHJcblxyXG5jbGFzcyBWZWNMaXRlIHtcclxuICBjb25zdHJ1Y3Rvcihjb25maWcpIHtcclxuICAgIHRoaXMuY29uZmlnID0ge1xyXG4gICAgICBmaWxlX25hbWU6IFwiZW1iZWRkaW5ncy0zLmpzb25cIixcclxuICAgICAgZm9sZGVyX3BhdGg6IFwiLnZlY19saXRlXCIsXHJcbiAgICAgIGV4aXN0c19hZGFwdGVyOiBudWxsLFxyXG4gICAgICBta2Rpcl9hZGFwdGVyOiBudWxsLFxyXG4gICAgICByZWFkX2FkYXB0ZXI6IG51bGwsXHJcbiAgICAgIHJlbmFtZV9hZGFwdGVyOiBudWxsLFxyXG4gICAgICBzdGF0X2FkYXB0ZXI6IG51bGwsXHJcbiAgICAgIHdyaXRlX2FkYXB0ZXI6IG51bGwsXHJcbiAgICAgIC4uLmNvbmZpZ1xyXG4gICAgfTtcclxuICAgIHRoaXMuZmlsZV9uYW1lID0gdGhpcy5jb25maWcuZmlsZV9uYW1lO1xyXG4gICAgdGhpcy5mb2xkZXJfcGF0aCA9IGNvbmZpZy5mb2xkZXJfcGF0aDtcclxuICAgIHRoaXMuZmlsZV9wYXRoID0gdGhpcy5mb2xkZXJfcGF0aCArIFwiL1wiICsgdGhpcy5maWxlX25hbWU7XHJcbiAgICB0aGlzLmVtYmVkZGluZ3MgPSBmYWxzZTtcclxuICB9XHJcbiAgYXN5bmMgZmlsZV9leGlzdHMocGF0aCkge1xyXG4gICAgaWYgKHRoaXMuY29uZmlnLmV4aXN0c19hZGFwdGVyKSB7XHJcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbmZpZy5leGlzdHNfYWRhcHRlcihwYXRoKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihcImV4aXN0c19hZGFwdGVyIG5vdCBzZXRcIik7XHJcbiAgICB9XHJcbiAgfVxyXG4gIGFzeW5jIG1rZGlyKHBhdGgpIHtcclxuICAgIGlmICh0aGlzLmNvbmZpZy5ta2Rpcl9hZGFwdGVyKSB7XHJcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbmZpZy5ta2Rpcl9hZGFwdGVyKHBhdGgpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwibWtkaXJfYWRhcHRlciBub3Qgc2V0XCIpO1xyXG4gICAgfVxyXG4gIH1cclxuICBhc3luYyByZWFkX2ZpbGUocGF0aCkge1xyXG4gICAgaWYgKHRoaXMuY29uZmlnLnJlYWRfYWRhcHRlcikge1xyXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5jb25maWcucmVhZF9hZGFwdGVyKHBhdGgpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwicmVhZF9hZGFwdGVyIG5vdCBzZXRcIik7XHJcbiAgICB9XHJcbiAgfVxyXG4gIGFzeW5jIHJlbmFtZShvbGRfcGF0aCwgbmV3X3BhdGgpIHtcclxuICAgIGlmICh0aGlzLmNvbmZpZy5yZW5hbWVfYWRhcHRlcikge1xyXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5jb25maWcucmVuYW1lX2FkYXB0ZXIob2xkX3BhdGgsIG5ld19wYXRoKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInJlbmFtZV9hZGFwdGVyIG5vdCBzZXRcIik7XHJcbiAgICB9XHJcbiAgfVxyXG4gIGFzeW5jIHN0YXQocGF0aCkge1xyXG4gICAgaWYgKHRoaXMuY29uZmlnLnN0YXRfYWRhcHRlcikge1xyXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5jb25maWcuc3RhdF9hZGFwdGVyKHBhdGgpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3RhdF9hZGFwdGVyIG5vdCBzZXRcIik7XHJcbiAgICB9XHJcbiAgfVxyXG4gIGFzeW5jIHdyaXRlX2ZpbGUocGF0aCwgZGF0YSkge1xyXG4gICAgaWYgKHRoaXMuY29uZmlnLndyaXRlX2FkYXB0ZXIpIHtcclxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuY29uZmlnLndyaXRlX2FkYXB0ZXIocGF0aCwgZGF0YSk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJ3cml0ZV9hZGFwdGVyIG5vdCBzZXRcIik7XHJcbiAgICB9XHJcbiAgfVxyXG4gIGFzeW5jIGxvYWQocmV0cmllcyA9IDApIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IGVtYmVkZGluZ3NfZmlsZSA9IGF3YWl0IHRoaXMucmVhZF9maWxlKHRoaXMuZmlsZV9wYXRoKTtcclxuICAgICAgdGhpcy5lbWJlZGRpbmdzID0gSlNPTi5wYXJzZShlbWJlZGRpbmdzX2ZpbGUpO1xyXG4gICAgICBjb25zb2xlLmxvZyhcImxvYWRlZCBlbWJlZGRpbmdzIGZpbGU6IFwiICsgdGhpcy5maWxlX3BhdGgpO1xyXG4gICAgICByZXR1cm4gdHJ1ZTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGlmIChyZXRyaWVzIDwgMykge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKFwicmV0cnlpbmcgbG9hZCgpXCIpO1xyXG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyKSA9PiBzZXRUaW1lb3V0KHIsIDFlMyArIDFlMyAqIHJldHJpZXMpKTtcclxuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5sb2FkKHJldHJpZXMgKyAxKTtcclxuICAgICAgfSBlbHNlIGlmIChyZXRyaWVzID09PSAzKSB7XHJcbiAgICAgICAgY29uc3QgZW1iZWRkaW5nc18yX2ZpbGVfcGF0aCA9IHRoaXMuZm9sZGVyX3BhdGggKyBcIi9lbWJlZGRpbmdzLTIuanNvblwiO1xyXG4gICAgICAgIGNvbnN0IGVtYmVkZGluZ3NfMl9maWxlX2V4aXN0cyA9IGF3YWl0IHRoaXMuZmlsZV9leGlzdHMoZW1iZWRkaW5nc18yX2ZpbGVfcGF0aCk7XHJcbiAgICAgICAgaWYgKGVtYmVkZGluZ3NfMl9maWxlX2V4aXN0cykge1xyXG4gICAgICAgICAgYXdhaXQgdGhpcy5taWdyYXRlX2VtYmVkZGluZ3NfdjJfdG9fdjMoKTtcclxuICAgICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmxvYWQocmV0cmllcyArIDEpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICBjb25zb2xlLmxvZyhcImZhaWxlZCB0byBsb2FkIGVtYmVkZGluZ3MgZmlsZSwgcHJvbXB0IHVzZXIgdG8gaW5pdGlhdGUgYnVsayBlbWJlZFwiKTtcclxuICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gIH1cclxuICBhc3luYyBtaWdyYXRlX2VtYmVkZGluZ3NfdjJfdG9fdjMoKSB7XHJcbiAgICBjb25zb2xlLmxvZyhcIm1pZ3JhdGluZyBlbWJlZGRpbmdzLTIuanNvbiB0byBlbWJlZGRpbmdzLTMuanNvblwiKTtcclxuICAgIGNvbnN0IGVtYmVkZGluZ3NfMl9maWxlX3BhdGggPSB0aGlzLmZvbGRlcl9wYXRoICsgXCIvZW1iZWRkaW5ncy0yLmpzb25cIjtcclxuICAgIGNvbnN0IGVtYmVkZGluZ3NfMl9maWxlID0gYXdhaXQgdGhpcy5yZWFkX2ZpbGUoZW1iZWRkaW5nc18yX2ZpbGVfcGF0aCk7XHJcbiAgICBjb25zdCBlbWJlZGRpbmdzXzIgPSBKU09OLnBhcnNlKGVtYmVkZGluZ3NfMl9maWxlKTtcclxuICAgIGNvbnN0IGVtYmVkZGluZ3NfMyA9IHt9O1xyXG4gICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoZW1iZWRkaW5nc18yKSkge1xyXG4gICAgICBjb25zdCBuZXdfb2JqID0ge1xyXG4gICAgICAgIHZlYzogdmFsdWUudmVjLFxyXG4gICAgICAgIG1ldGE6IHt9XHJcbiAgICAgIH07XHJcbiAgICAgIGNvbnN0IG1ldGEgPSB2YWx1ZS5tZXRhO1xyXG4gICAgICBjb25zdCBuZXdfbWV0YSA9IHt9O1xyXG4gICAgICBpZiAobWV0YS5oYXNoKVxyXG4gICAgICAgIG5ld19tZXRhLmhhc2ggPSBtZXRhLmhhc2g7XHJcbiAgICAgIGlmIChtZXRhLmZpbGUpXHJcbiAgICAgICAgbmV3X21ldGEucGFyZW50ID0gbWV0YS5maWxlO1xyXG4gICAgICBpZiAobWV0YS5ibG9ja3MpXHJcbiAgICAgICAgbmV3X21ldGEuY2hpbGRyZW4gPSBtZXRhLmJsb2NrcztcclxuICAgICAgaWYgKG1ldGEubXRpbWUpXHJcbiAgICAgICAgbmV3X21ldGEubXRpbWUgPSBtZXRhLm10aW1lO1xyXG4gICAgICBpZiAobWV0YS5zaXplKVxyXG4gICAgICAgIG5ld19tZXRhLnNpemUgPSBtZXRhLnNpemU7XHJcbiAgICAgIGlmIChtZXRhLmxlbilcclxuICAgICAgICBuZXdfbWV0YS5zaXplID0gbWV0YS5sZW47XHJcbiAgICAgIGlmIChtZXRhLnBhdGgpXHJcbiAgICAgICAgbmV3X21ldGEucGF0aCA9IG1ldGEucGF0aDtcclxuICAgICAgbmV3X21ldGEuc3JjID0gXCJmaWxlXCI7XHJcbiAgICAgIG5ld19vYmoubWV0YSA9IG5ld19tZXRhO1xyXG4gICAgICBlbWJlZGRpbmdzXzNba2V5XSA9IG5ld19vYmo7XHJcbiAgICB9XHJcbiAgICBjb25zdCBlbWJlZGRpbmdzXzNfZmlsZSA9IEpTT04uc3RyaW5naWZ5KGVtYmVkZGluZ3NfMyk7XHJcbiAgICBhd2FpdCB0aGlzLndyaXRlX2ZpbGUodGhpcy5maWxlX3BhdGgsIGVtYmVkZGluZ3NfM19maWxlKTtcclxuICB9XHJcbiAgYXN5bmMgaW5pdF9lbWJlZGRpbmdzX2ZpbGUoKSB7XHJcbiAgICBpZiAoIWF3YWl0IHRoaXMuZmlsZV9leGlzdHModGhpcy5mb2xkZXJfcGF0aCkpIHtcclxuICAgICAgYXdhaXQgdGhpcy5ta2Rpcih0aGlzLmZvbGRlcl9wYXRoKTtcclxuICAgICAgY29uc29sZS5sb2coXCJjcmVhdGVkIGZvbGRlcjogXCIgKyB0aGlzLmZvbGRlcl9wYXRoKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKFwiZm9sZGVyIGFscmVhZHkgZXhpc3RzOiBcIiArIHRoaXMuZm9sZGVyX3BhdGgpO1xyXG4gICAgfVxyXG4gICAgaWYgKCFhd2FpdCB0aGlzLmZpbGVfZXhpc3RzKHRoaXMuZmlsZV9wYXRoKSkge1xyXG4gICAgICBhd2FpdCB0aGlzLndyaXRlX2ZpbGUodGhpcy5maWxlX3BhdGgsIFwie31cIik7XHJcbiAgICAgIGNvbnNvbGUubG9nKFwiY3JlYXRlZCBlbWJlZGRpbmdzIGZpbGU6IFwiICsgdGhpcy5maWxlX3BhdGgpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgY29uc29sZS5sb2coXCJlbWJlZGRpbmdzIGZpbGUgYWxyZWFkeSBleGlzdHM6IFwiICsgdGhpcy5maWxlX3BhdGgpO1xyXG4gICAgfVxyXG4gIH1cclxuICBhc3luYyBzYXZlKCkge1xyXG4gICAgY29uc3QgZW1iZWRkaW5ncyA9IEpTT04uc3RyaW5naWZ5KHRoaXMuZW1iZWRkaW5ncyk7XHJcbiAgICBjb25zdCBlbWJlZGRpbmdzX2ZpbGVfZXhpc3RzID0gYXdhaXQgdGhpcy5maWxlX2V4aXN0cyh0aGlzLmZpbGVfcGF0aCk7XHJcbiAgICBpZiAoZW1iZWRkaW5nc19maWxlX2V4aXN0cykge1xyXG4gICAgICBjb25zdCBuZXdfZmlsZV9zaXplID0gZW1iZWRkaW5ncy5sZW5ndGg7XHJcbiAgICAgIGNvbnN0IGV4aXN0aW5nX2ZpbGVfc2l6ZSA9IGF3YWl0IHRoaXMuc3RhdCh0aGlzLmZpbGVfcGF0aCkudGhlbigoc3RhdCkgPT4gc3RhdC5zaXplKTtcclxuICAgICAgaWYgKG5ld19maWxlX3NpemUgPiBleGlzdGluZ19maWxlX3NpemUgKiAwLjUpIHtcclxuICAgICAgICBhd2FpdCB0aGlzLndyaXRlX2ZpbGUodGhpcy5maWxlX3BhdGgsIGVtYmVkZGluZ3MpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKFwiZW1iZWRkaW5ncyBmaWxlIHNpemU6IFwiICsgbmV3X2ZpbGVfc2l6ZSArIFwiIGJ5dGVzXCIpO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGNvbnN0IHdhcm5pbmdfbWVzc2FnZSA9IFtcclxuICAgICAgICAgIFwiV2FybmluZzogTmV3IGVtYmVkZGluZ3MgZmlsZSBzaXplIGlzIHNpZ25pZmljYW50bHkgc21hbGxlciB0aGFuIGV4aXN0aW5nIGVtYmVkZGluZ3MgZmlsZSBzaXplLlwiLFxyXG4gICAgICAgICAgXCJBYm9ydGluZyB0byBwcmV2ZW50IHBvc3NpYmxlIGxvc3Mgb2YgZW1iZWRkaW5ncyBkYXRhLlwiLFxyXG4gICAgICAgICAgXCJOZXcgZmlsZSBzaXplOiBcIiArIG5ld19maWxlX3NpemUgKyBcIiBieXRlcy5cIixcclxuICAgICAgICAgIFwiRXhpc3RpbmcgZmlsZSBzaXplOiBcIiArIGV4aXN0aW5nX2ZpbGVfc2l6ZSArIFwiIGJ5dGVzLlwiLFxyXG4gICAgICAgICAgXCJSZXN0YXJ0aW5nIE9ic2lkaWFuIG1heSBmaXggdGhpcy5cIlxyXG4gICAgICAgIF07XHJcbiAgICAgICAgY29uc29sZS5sb2cod2FybmluZ19tZXNzYWdlLmpvaW4oXCIgXCIpKTtcclxuICAgICAgICBhd2FpdCB0aGlzLndyaXRlX2ZpbGUodGhpcy5mb2xkZXJfcGF0aCArIFwiL3Vuc2F2ZWQtZW1iZWRkaW5ncy5qc29uXCIsIGVtYmVkZGluZ3MpO1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkVycm9yOiBOZXcgZW1iZWRkaW5ncyBmaWxlIHNpemUgaXMgc2lnbmlmaWNhbnRseSBzbWFsbGVyIHRoYW4gZXhpc3RpbmcgZW1iZWRkaW5ncyBmaWxlIHNpemUuIEFib3J0aW5nIHRvIHByZXZlbnQgcG9zc2libGUgbG9zcyBvZiBlbWJlZGRpbmdzIGRhdGEuXCIpO1xyXG4gICAgICB9XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBhd2FpdCB0aGlzLmluaXRfZW1iZWRkaW5nc19maWxlKCk7XHJcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLnNhdmUoKTtcclxuICAgIH1cclxuICAgIHJldHVybiB0cnVlO1xyXG4gIH1cclxuICBjb3Nfc2ltKHZlY3RvcjEsIHZlY3RvcjIpIHtcclxuICAgIGxldCBkb3RQcm9kdWN0ID0gMDtcclxuICAgIGxldCBub3JtQSA9IDA7XHJcbiAgICBsZXQgbm9ybUIgPSAwO1xyXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB2ZWN0b3IxLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgIGRvdFByb2R1Y3QgKz0gdmVjdG9yMVtpXSAqIHZlY3RvcjJbaV07XHJcbiAgICAgIG5vcm1BICs9IHZlY3RvcjFbaV0gKiB2ZWN0b3IxW2ldO1xyXG4gICAgICBub3JtQiArPSB2ZWN0b3IyW2ldICogdmVjdG9yMltpXTtcclxuICAgIH1cclxuICAgIGlmIChub3JtQSA9PT0gMCB8fCBub3JtQiA9PT0gMCkge1xyXG4gICAgICByZXR1cm4gMDtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIHJldHVybiBkb3RQcm9kdWN0IC8gKE1hdGguc3FydChub3JtQSkgKiBNYXRoLnNxcnQobm9ybUIpKTtcclxuICAgIH1cclxuICB9XHJcbiAgbmVhcmVzdCh0b192ZWMsIGZpbHRlciA9IHt9KSB7XHJcbiAgICBmaWx0ZXIgPSB7XHJcbiAgICAgIHJlc3VsdHNfY291bnQ6IDMwLFxyXG4gICAgICAuLi5maWx0ZXJcclxuICAgIH07XHJcbiAgICBsZXQgbmVhcmVzdCA9IFtdO1xyXG4gICAgY29uc3QgZnJvbV9rZXlzID0gT2JqZWN0LmtleXModGhpcy5lbWJlZGRpbmdzKTtcclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZnJvbV9rZXlzLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgIGlmIChmaWx0ZXIuc2tpcF9zZWN0aW9ucykge1xyXG4gICAgICAgIGNvbnN0IGZyb21fcGF0aCA9IHRoaXMuZW1iZWRkaW5nc1tmcm9tX2tleXNbaV1dLm1ldGEucGF0aDtcclxuICAgICAgICBpZiAoZnJvbV9wYXRoLmluZGV4T2YoXCIjXCIpID4gLTEpXHJcbiAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG4gICAgICBpZiAoZmlsdGVyLnNraXBfa2V5KSB7XHJcbiAgICAgICAgaWYgKGZpbHRlci5za2lwX2tleSA9PT0gZnJvbV9rZXlzW2ldKVxyXG4gICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgaWYgKGZpbHRlci5za2lwX2tleSA9PT0gdGhpcy5lbWJlZGRpbmdzW2Zyb21fa2V5c1tpXV0ubWV0YS5wYXJlbnQpXHJcbiAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG4gICAgICBpZiAoZmlsdGVyLnBhdGhfYmVnaW5zX3dpdGgpIHtcclxuICAgICAgICBpZiAodHlwZW9mIGZpbHRlci5wYXRoX2JlZ2luc193aXRoID09PSBcInN0cmluZ1wiICYmICF0aGlzLmVtYmVkZGluZ3NbZnJvbV9rZXlzW2ldXS5tZXRhLnBhdGguc3RhcnRzV2l0aChmaWx0ZXIucGF0aF9iZWdpbnNfd2l0aCkpXHJcbiAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShmaWx0ZXIucGF0aF9iZWdpbnNfd2l0aCkgJiYgIWZpbHRlci5wYXRoX2JlZ2luc193aXRoLnNvbWUoKHBhdGgpID0+IHRoaXMuZW1iZWRkaW5nc1tmcm9tX2tleXNbaV1dLm1ldGEucGF0aC5zdGFydHNXaXRoKHBhdGgpKSlcclxuICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcbiAgICAgIG5lYXJlc3QucHVzaCh7XHJcbiAgICAgICAgbGluazogdGhpcy5lbWJlZGRpbmdzW2Zyb21fa2V5c1tpXV0ubWV0YS5wYXRoLFxyXG4gICAgICAgIHNpbWlsYXJpdHk6IHRoaXMuY29zX3NpbSh0b192ZWMsIHRoaXMuZW1iZWRkaW5nc1tmcm9tX2tleXNbaV1dLnZlYyksXHJcbiAgICAgICAgc2l6ZTogdGhpcy5lbWJlZGRpbmdzW2Zyb21fa2V5c1tpXV0ubWV0YS5zaXplXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgbmVhcmVzdC5zb3J0KGZ1bmN0aW9uIChhLCBiKSB7XHJcbiAgICAgIHJldHVybiBiLnNpbWlsYXJpdHkgLSBhLnNpbWlsYXJpdHk7XHJcbiAgICB9KTtcclxuICAgIG5lYXJlc3QgPSBuZWFyZXN0LnNsaWNlKDAsIGZpbHRlci5yZXN1bHRzX2NvdW50KTtcclxuICAgIHJldHVybiBuZWFyZXN0O1xyXG4gIH1cclxuICBmaW5kX25lYXJlc3RfZW1iZWRkaW5ncyh0b192ZWMsIGZpbHRlciA9IHt9KSB7XHJcbiAgICBjb25zdCBkZWZhdWx0X2ZpbHRlciA9IHtcclxuICAgICAgbWF4OiB0aGlzLm1heF9zb3VyY2VzXHJcbiAgICB9O1xyXG4gICAgZmlsdGVyID0geyAuLi5kZWZhdWx0X2ZpbHRlciwgLi4uZmlsdGVyIH07XHJcbiAgICBpZiAoQXJyYXkuaXNBcnJheSh0b192ZWMpICYmIHRvX3ZlYy5sZW5ndGggIT09IHRoaXMudmVjX2xlbikge1xyXG4gICAgICB0aGlzLm5lYXJlc3QgPSB7fTtcclxuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0b192ZWMubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICB0aGlzLmZpbmRfbmVhcmVzdF9lbWJlZGRpbmdzKHRvX3ZlY1tpXSwge1xyXG4gICAgICAgICAgbWF4OiBNYXRoLmZsb29yKGZpbHRlci5tYXggLyB0b192ZWMubGVuZ3RoKVxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBjb25zdCBmcm9tX2tleXMgPSBPYmplY3Qua2V5cyh0aGlzLmVtYmVkZGluZ3MpO1xyXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGZyb21fa2V5cy5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgIGlmICh0aGlzLnZhbGlkYXRlX3R5cGUodGhpcy5lbWJlZGRpbmdzW2Zyb21fa2V5c1tpXV0pKVxyXG4gICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgY29uc3Qgc2ltID0gdGhpcy5jb21wdXRlQ29zaW5lU2ltaWxhcml0eSh0b192ZWMsIHRoaXMuZW1iZWRkaW5nc1tmcm9tX2tleXNbaV1dLnZlYyk7XHJcbiAgICAgICAgaWYgKHRoaXMubmVhcmVzdFtmcm9tX2tleXNbaV1dKSB7XHJcbiAgICAgICAgICB0aGlzLm5lYXJlc3RbZnJvbV9rZXlzW2ldXSArPSBzaW07XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIHRoaXMubmVhcmVzdFtmcm9tX2tleXNbaV1dID0gc2ltO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgbGV0IG5lYXJlc3QgPSBPYmplY3Qua2V5cyh0aGlzLm5lYXJlc3QpLm1hcCgoa2V5KSA9PiB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAga2V5LFxyXG4gICAgICAgIHNpbWlsYXJpdHk6IHRoaXMubmVhcmVzdFtrZXldXHJcbiAgICAgIH07XHJcbiAgICB9KTtcclxuICAgIG5lYXJlc3QgPSB0aGlzLnNvcnRfYnlfc2ltaWxhcml0eShuZWFyZXN0KTtcclxuICAgIG5lYXJlc3QgPSBuZWFyZXN0LnNsaWNlKDAsIGZpbHRlci5tYXgpO1xyXG4gICAgbmVhcmVzdCA9IG5lYXJlc3QubWFwKChpdGVtKSA9PiB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgbGluazogdGhpcy5lbWJlZGRpbmdzW2l0ZW0ua2V5XS5tZXRhLnBhdGgsXHJcbiAgICAgICAgc2ltaWxhcml0eTogaXRlbS5zaW1pbGFyaXR5LFxyXG4gICAgICAgIGxlbjogdGhpcy5lbWJlZGRpbmdzW2l0ZW0ua2V5XS5tZXRhLmxlbiB8fCB0aGlzLmVtYmVkZGluZ3NbaXRlbS5rZXldLm1ldGEuc2l6ZVxyXG4gICAgICB9O1xyXG4gICAgfSk7XHJcbiAgICByZXR1cm4gbmVhcmVzdDtcclxuICB9XHJcbiAgc29ydF9ieV9zaW1pbGFyaXR5KG5lYXJlc3QpIHtcclxuICAgIHJldHVybiBuZWFyZXN0LnNvcnQoZnVuY3Rpb24gKGEsIGIpIHtcclxuICAgICAgY29uc3QgYV9zY29yZSA9IGEuc2ltaWxhcml0eTtcclxuICAgICAgY29uc3QgYl9zY29yZSA9IGIuc2ltaWxhcml0eTtcclxuICAgICAgaWYgKGFfc2NvcmUgPiBiX3Njb3JlKVxyXG4gICAgICAgIHJldHVybiAtMTtcclxuICAgICAgaWYgKGFfc2NvcmUgPCBiX3Njb3JlKVxyXG4gICAgICAgIHJldHVybiAxO1xyXG4gICAgICByZXR1cm4gMDtcclxuICAgIH0pO1xyXG4gIH1cclxuICAvLyBjaGVjayBpZiBrZXkgZnJvbSBlbWJlZGRpbmdzIGV4aXN0cyBpbiBmaWxlc1xyXG4gIGNsZWFuX3VwX2VtYmVkZGluZ3MoZmlsZXMpIHtcclxuICAgIGNvbnNvbGUubG9nKFwiY2xlYW5pbmcgdXAgZW1iZWRkaW5nc1wiKTtcclxuICAgIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyh0aGlzLmVtYmVkZGluZ3MpO1xyXG4gICAgbGV0IGRlbGV0ZWRfZW1iZWRkaW5ncyA9IDA7XHJcbiAgICBmb3IgKGNvbnN0IGtleSBvZiBrZXlzKSB7XHJcbiAgICAgIGNvbnN0IHBhdGggPSB0aGlzLmVtYmVkZGluZ3Nba2V5XS5tZXRhLnBhdGg7XHJcbiAgICAgIGlmICghZmlsZXMuZmluZCgoZmlsZSkgPT4gcGF0aC5zdGFydHNXaXRoKGZpbGUucGF0aCkpKSB7XHJcbiAgICAgICAgZGVsZXRlIHRoaXMuZW1iZWRkaW5nc1trZXldO1xyXG4gICAgICAgIGRlbGV0ZWRfZW1iZWRkaW5ncysrO1xyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChwYXRoLmluZGV4T2YoXCIjXCIpID4gLTEpIHtcclxuICAgICAgICBjb25zdCBwYXJlbnRfa2V5ID0gdGhpcy5lbWJlZGRpbmdzW2tleV0ubWV0YS5wYXJlbnQ7XHJcbiAgICAgICAgaWYgKCF0aGlzLmVtYmVkZGluZ3NbcGFyZW50X2tleV0pIHtcclxuICAgICAgICAgIGRlbGV0ZSB0aGlzLmVtYmVkZGluZ3Nba2V5XTtcclxuICAgICAgICAgIGRlbGV0ZWRfZW1iZWRkaW5ncysrO1xyXG4gICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmICghdGhpcy5lbWJlZGRpbmdzW3BhcmVudF9rZXldLm1ldGEpIHtcclxuICAgICAgICAgIGRlbGV0ZSB0aGlzLmVtYmVkZGluZ3Nba2V5XTtcclxuICAgICAgICAgIGRlbGV0ZWRfZW1iZWRkaW5ncysrO1xyXG4gICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmICh0aGlzLmVtYmVkZGluZ3NbcGFyZW50X2tleV0ubWV0YS5jaGlsZHJlbiAmJiB0aGlzLmVtYmVkZGluZ3NbcGFyZW50X2tleV0ubWV0YS5jaGlsZHJlbi5pbmRleE9mKGtleSkgPCAwKSB7XHJcbiAgICAgICAgICBkZWxldGUgdGhpcy5lbWJlZGRpbmdzW2tleV07XHJcbiAgICAgICAgICBkZWxldGVkX2VtYmVkZGluZ3MrKztcclxuICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIHsgZGVsZXRlZF9lbWJlZGRpbmdzLCB0b3RhbF9lbWJlZGRpbmdzOiBrZXlzLmxlbmd0aCB9O1xyXG4gIH1cclxuICBnZXQoa2V5KSB7XHJcbiAgICByZXR1cm4gdGhpcy5lbWJlZGRpbmdzW2tleV0gfHwgbnVsbDtcclxuICB9XHJcbiAgZ2V0X21ldGEoa2V5KSB7XHJcbiAgICBjb25zdCBlbWJlZGRpbmcgPSB0aGlzLmdldChrZXkpO1xyXG4gICAgaWYgKGVtYmVkZGluZyAmJiBlbWJlZGRpbmcubWV0YSkge1xyXG4gICAgICByZXR1cm4gZW1iZWRkaW5nLm1ldGE7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbnVsbDtcclxuICB9XHJcbiAgZ2V0X210aW1lKGtleSkge1xyXG4gICAgY29uc3QgbWV0YSA9IHRoaXMuZ2V0X21ldGEoa2V5KTtcclxuICAgIGlmIChtZXRhICYmIG1ldGEubXRpbWUpIHtcclxuICAgICAgcmV0dXJuIG1ldGEubXRpbWU7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbnVsbDtcclxuICB9XHJcbiAgZ2V0X2hhc2goa2V5KSB7XHJcbiAgICBjb25zdCBtZXRhID0gdGhpcy5nZXRfbWV0YShrZXkpO1xyXG4gICAgaWYgKG1ldGEgJiYgbWV0YS5oYXNoKSB7XHJcbiAgICAgIHJldHVybiBtZXRhLmhhc2g7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbnVsbDtcclxuICB9XHJcbiAgZ2V0X3NpemUoa2V5KSB7XHJcbiAgICBjb25zdCBtZXRhID0gdGhpcy5nZXRfbWV0YShrZXkpO1xyXG4gICAgaWYgKG1ldGEgJiYgbWV0YS5zaXplKSB7XHJcbiAgICAgIHJldHVybiBtZXRhLnNpemU7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbnVsbDtcclxuICB9XHJcbiAgZ2V0X2NoaWxkcmVuKGtleSkge1xyXG4gICAgY29uc3QgbWV0YSA9IHRoaXMuZ2V0X21ldGEoa2V5KTtcclxuICAgIGlmIChtZXRhICYmIG1ldGEuY2hpbGRyZW4pIHtcclxuICAgICAgcmV0dXJuIG1ldGEuY2hpbGRyZW47XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbnVsbDtcclxuICB9XHJcbiAgZ2V0X3ZlYyhrZXkpIHtcclxuICAgIGNvbnN0IGVtYmVkZGluZyA9IHRoaXMuZ2V0KGtleSk7XHJcbiAgICBpZiAoZW1iZWRkaW5nICYmIGVtYmVkZGluZy52ZWMpIHtcclxuICAgICAgcmV0dXJuIGVtYmVkZGluZy52ZWM7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbnVsbDtcclxuICB9XHJcbiAgc2F2ZV9lbWJlZGRpbmcoa2V5LCB2ZWMsIG1ldGEpIHtcclxuICAgIHRoaXMuZW1iZWRkaW5nc1trZXldID0ge1xyXG4gICAgICB2ZWMsXHJcbiAgICAgIG1ldGFcclxuICAgIH07XHJcbiAgfVxyXG4gIG10aW1lX2lzX2N1cnJlbnQoa2V5LCBzb3VyY2VfbXRpbWUpIHtcclxuICAgIGNvbnN0IG10aW1lID0gdGhpcy5nZXRfbXRpbWUoa2V5KTtcclxuICAgIGlmIChtdGltZSAmJiBtdGltZSA+PSBzb3VyY2VfbXRpbWUpIHtcclxuICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbiAgfVxyXG4gIGFzeW5jIGZvcmNlX3JlZnJlc2goKSB7XHJcbiAgICB0aGlzLmVtYmVkZGluZ3MgPSBudWxsO1xyXG4gICAgdGhpcy5lbWJlZGRpbmdzID0ge307XHJcbiAgICBsZXQgY3VycmVudF9kYXRldGltZSA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDFlMyk7XHJcbiAgICBhd2FpdCB0aGlzLnJlbmFtZSh0aGlzLmZpbGVfcGF0aCwgdGhpcy5mb2xkZXJfcGF0aCArIFwiL2VtYmVkZGluZ3MtXCIgKyBjdXJyZW50X2RhdGV0aW1lICsgXCIuanNvblwiKTtcclxuICAgIGF3YWl0IHRoaXMuaW5pdF9lbWJlZGRpbmdzX2ZpbGUoKTtcclxuICB9XHJcbn07XHJcblxyXG4vL2NyZWF0ZSBvbmUgb2JqZWN0IHdpdGggYWxsIHRoZSB0cmFuc2xhdGlvbnNcclxuLy8gcmVzZWFyY2ggOiBTTUFSVF9UUkFOU0xBVElPTltsYW5ndWFnZV1ba2V5XVxyXG5jb25zdCBTTUFSVF9UUkFOU0xBVElPTiA9IHtcclxuICBcInpoXCI6IHtcclxuICAgIFwicHJvbm91c1wiOiBbXCJcdTYyMTFcIiwgXCJcdTYyMTFcdTc2ODRcIiwgXCJcdTRGRkFcIiwgXCJcdTYyMTFcdTRFRUNcIiwgXCJcdTYyMTFcdTRFRUNcdTc2ODRcIl0sXHJcbiAgICBcInByb21wdFwiOiBcIlx1NTdGQVx1NEU4RVx1NjIxMVx1NzY4NFx1N0IxNFx1OEJCMFwiLFxyXG4gICAgXCJpbml0aWFsX21lc3NhZ2VcIjogYFx1NEY2MFx1NTk3RFx1RkYwQ1x1NjIxMVx1NjYyRlx1ODBGRFx1OTAxQVx1OEZDNyBTbWFydCBDb25uZWN0aW9ucyBcdThCQkZcdTk1RUVcdTRGNjBcdTc2ODRcdTdCMTRcdThCQjBcdTc2ODQgQ2hhdEdQVFx1MzAwMlx1NEY2MFx1NTNFRlx1NEVFNVx1OTVFRVx1NjIxMVx1NTE3M1x1NEU4RVx1NEY2MFx1N0IxNFx1OEJCMFx1NzY4NFx1OTVFRVx1OTg5OFx1RkYwQ1x1NjIxMVx1NEYxQVx1OTYwNVx1OEJGQlx1NUU3Nlx1NzQwNlx1ODlFM1x1NEY2MFx1NzY4NFx1N0IxNFx1OEJCMFx1RkYwQ1x1NUU3Nlx1NUMzRFx1NTI5Qlx1NTZERVx1N0I1NFx1NEY2MFx1NzY4NFx1OTVFRVx1OTg5OFx1MzAwMmBcclxuICB9LFxyXG59XHJcblxyXG4vLyByZXF1aXJlIGJ1aWx0LWluIGNyeXB0byBtb2R1bGVcclxuY29uc3QgY3J5cHRvID0gcmVxdWlyZShcImNyeXB0b1wiKTtcclxuLy8gbWQ1IGhhc2ggdXNpbmcgYnVpbHQgaW4gY3J5cHRvIG1vZHVsZVxyXG5mdW5jdGlvbiBtZDUoc3RyKSB7XHJcbiAgcmV0dXJuIGNyeXB0by5jcmVhdGVIYXNoKFwibWQ1XCIpLnVwZGF0ZShzdHIpLmRpZ2VzdChcImhleFwiKTtcclxufVxyXG5cclxuY2xhc3MgU21hcnRDb25uZWN0aW9uc1BsdWdpbiBleHRlbmRzIE9ic2lkaWFuLlBsdWdpbiB7XHJcbiAgLy8gY29uc3RydWN0b3JcclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIHN1cGVyKC4uLmFyZ3VtZW50cyk7XHJcbiAgICB0aGlzLmFwaSA9IG51bGw7XHJcbiAgICB0aGlzLmVtYmVkZGluZ3NfbG9hZGVkID0gZmFsc2U7XHJcbiAgICB0aGlzLmZpbGVfZXhjbHVzaW9ucyA9IFtdO1xyXG4gICAgdGhpcy5mb2xkZXJzID0gW107XHJcbiAgICB0aGlzLmhhc19uZXdfZW1iZWRkaW5ncyA9IGZhbHNlO1xyXG4gICAgdGhpcy5oZWFkZXJfZXhjbHVzaW9ucyA9IFtdO1xyXG4gICAgdGhpcy5uZWFyZXN0X2NhY2hlID0ge307XHJcbiAgICB0aGlzLnBhdGhfb25seSA9IFtdO1xyXG4gICAgdGhpcy5yZW5kZXJfbG9nID0ge307XHJcbiAgICB0aGlzLnJlbmRlcl9sb2cuZGVsZXRlZF9lbWJlZGRpbmdzID0gMDtcclxuICAgIHRoaXMucmVuZGVyX2xvZy5leGNsdXNpb25zX2xvZ3MgPSB7fTtcclxuICAgIHRoaXMucmVuZGVyX2xvZy5mYWlsZWRfZW1iZWRkaW5ncyA9IFtdO1xyXG4gICAgdGhpcy5yZW5kZXJfbG9nLmZpbGVzID0gW107XHJcbiAgICB0aGlzLnJlbmRlcl9sb2cubmV3X2VtYmVkZGluZ3MgPSAwO1xyXG4gICAgdGhpcy5yZW5kZXJfbG9nLnNraXBwZWRfbG93X2RlbHRhID0ge307XHJcbiAgICB0aGlzLnJlbmRlcl9sb2cudG9rZW5fdXNhZ2UgPSAwO1xyXG4gICAgdGhpcy5yZW5kZXJfbG9nLnRva2Vuc19zYXZlZF9ieV9jYWNoZSA9IDA7XHJcbiAgICB0aGlzLnJldHJ5X25vdGljZV90aW1lb3V0ID0gbnVsbDtcclxuICAgIHRoaXMuc2F2ZV90aW1lb3V0ID0gbnVsbDtcclxuICAgIHRoaXMuc2NfYnJhbmRpbmcgPSB7fTtcclxuICAgIC8vIHRoaXMuc2VsZl9yZWZfa3dfcmVnZXggPSBudWxsO1xyXG4gICAgdGhpcy51cGRhdGVfYXZhaWxhYmxlID0gZmFsc2U7XHJcbiAgfVxyXG5cclxuICBhc3luYyBvbmxvYWQoKSB7XHJcbiAgICAvLyBpbml0aWFsaXplIHdoZW4gbGF5b3V0IGlzIHJlYWR5XHJcbiAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSh0aGlzLmluaXRpYWxpemUuYmluZCh0aGlzKSk7XHJcbiAgfVxyXG4gIG9udW5sb2FkKCkge1xyXG4gICAgdGhpcy5vdXRwdXRfcmVuZGVyX2xvZygpO1xyXG4gICAgY29uc29sZS5sb2coXCJ1bmxvYWRpbmcgcGx1Z2luXCIpO1xyXG4gIH1cclxuICBhc3luYyBpbml0aWFsaXplKCkge1xyXG4gICAgY29uc29sZS5sb2coXCJ0ZXN0dGVzdFwiKTtcclxuICAgIGNvbnNvbGUubG9nKFwiTG9hZGluZyBTbWFydCBDb25uZWN0aW9ucyBwbHVnaW5cIik7XHJcbiAgICBWRVJTSU9OID0gdGhpcy5tYW5pZmVzdC52ZXJzaW9uO1xyXG4gICAgLy8gVkVSU0lPTiA9ICcxLjAuMCc7XHJcbiAgICAvLyBjb25zb2xlLmxvZyhWRVJTSU9OKTtcclxuICAgIGF3YWl0IHRoaXMubG9hZFNldHRpbmdzKCk7XHJcbiAgICAvLyBydW4gYWZ0ZXIgMyBzZWNvbmRzXHJcbiAgICBzZXRUaW1lb3V0KHRoaXMuY2hlY2tfZm9yX3VwZGF0ZS5iaW5kKHRoaXMpLCAzMDAwKTtcclxuICAgIC8vIHJ1biBjaGVjayBmb3IgdXBkYXRlIGV2ZXJ5IDMgaG91cnNcclxuICAgIHNldEludGVydmFsKHRoaXMuY2hlY2tfZm9yX3VwZGF0ZS5iaW5kKHRoaXMpLCAxMDgwMDAwMCk7XHJcblxyXG4gICAgdGhpcy5hZGRJY29uKCk7XHJcbiAgICB0aGlzLmFkZENvbW1hbmQoe1xyXG4gICAgICBpZDogXCJzYy1maW5kLW5vdGVzXCIsXHJcbiAgICAgIG5hbWU6IFwiRmluZDogTWFrZSBTbWFydCBDb25uZWN0aW9uc1wiLFxyXG4gICAgICBpY29uOiBcInBlbmNpbF9pY29uXCIsXHJcbiAgICAgIGhvdGtleXM6IFtdLFxyXG4gICAgICAvLyBlZGl0b3JDYWxsYmFjazogYXN5bmMgKGVkaXRvcikgPT4ge1xyXG4gICAgICBlZGl0b3JDYWxsYmFjazogYXN5bmMgKGVkaXRvcikgPT4ge1xyXG4gICAgICAgIGlmKGVkaXRvci5zb21ldGhpbmdTZWxlY3RlZCgpKSB7XHJcbiAgICAgICAgICAvLyBnZXQgc2VsZWN0ZWQgdGV4dFxyXG4gICAgICAgICAgbGV0IHNlbGVjdGVkX3RleHQgPSBlZGl0b3IuZ2V0U2VsZWN0aW9uKCk7XHJcbiAgICAgICAgICAvLyByZW5kZXIgY29ubmVjdGlvbnMgZnJvbSBzZWxlY3RlZCB0ZXh0XHJcbiAgICAgICAgICBhd2FpdCB0aGlzLm1ha2VfY29ubmVjdGlvbnMoc2VsZWN0ZWRfdGV4dCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIC8vIGNsZWFyIG5lYXJlc3RfY2FjaGUgb24gbWFudWFsIGNhbGwgdG8gbWFrZSBjb25uZWN0aW9uc1xyXG4gICAgICAgICAgdGhpcy5uZWFyZXN0X2NhY2hlID0ge307XHJcbiAgICAgICAgICAvLyBjb25zb2xlLmxvZyhcIkNsZWFyZWQgbmVhcmVzdF9jYWNoZVwiKTtcclxuICAgICAgICAgIGF3YWl0IHRoaXMubWFrZV9jb25uZWN0aW9ucygpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfSk7XHJcbiAgICB0aGlzLmFkZENvbW1hbmQoe1xyXG4gICAgICBpZDogXCJzbWFydC1jb25uZWN0aW9ucy12aWV3XCIsXHJcbiAgICAgIG5hbWU6IFwiT3BlbjogVmlldyBTbWFydCBDb25uZWN0aW9uc1wiLFxyXG4gICAgICBjYWxsYmFjazogKCkgPT4ge1xyXG4gICAgICAgIHRoaXMub3Blbl92aWV3KCk7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG4gICAgLy8gb3BlbiBjaGF0IGNvbW1hbmRcclxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XHJcbiAgICAgIGlkOiBcInNtYXJ0LWNvbm5lY3Rpb25zLWNoYXRcIixcclxuICAgICAgbmFtZTogXCJPcGVuOiBTbWFydCBDaGF0IENvbnZlcnNhdGlvblwiLFxyXG4gICAgICBjYWxsYmFjazogKCkgPT4ge1xyXG4gICAgICAgIHRoaXMub3Blbl9jaGF0KCk7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG4gICAgLy8gb3BlbiByYW5kb20gbm90ZSBmcm9tIG5lYXJlc3QgY2FjaGVcclxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XHJcbiAgICAgIGlkOiBcInNtYXJ0LWNvbm5lY3Rpb25zLXJhbmRvbVwiLFxyXG4gICAgICBuYW1lOiBcIk9wZW46IFJhbmRvbSBOb3RlIGZyb20gU21hcnQgQ29ubmVjdGlvbnNcIixcclxuICAgICAgY2FsbGJhY2s6ICgpID0+IHtcclxuICAgICAgICB0aGlzLm9wZW5fcmFuZG9tX25vdGUoKTtcclxuICAgICAgfVxyXG4gICAgfSk7XHJcbiAgICAvLyBhZGQgc2V0dGluZ3MgdGFiXHJcbiAgICB0aGlzLmFkZFNldHRpbmdUYWIobmV3IFNtYXJ0Q29ubmVjdGlvbnNTZXR0aW5nc1RhYih0aGlzLmFwcCwgdGhpcykpO1xyXG4gICAgLy8gcmVnaXN0ZXIgbWFpbiB2aWV3IHR5cGVcclxuICAgIHRoaXMucmVnaXN0ZXJWaWV3KFNNQVJUX0NPTk5FQ1RJT05TX1ZJRVdfVFlQRSwgKGxlYWYpID0+IChuZXcgU21hcnRDb25uZWN0aW9uc1ZpZXcobGVhZiwgdGhpcykpKTtcclxuICAgIC8vIHJlZ2lzdGVyIGNoYXQgdmlldyB0eXBlXHJcbiAgICB0aGlzLnJlZ2lzdGVyVmlldyhTTUFSVF9DT05ORUNUSU9OU19DSEFUX1ZJRVdfVFlQRSwgKGxlYWYpID0+IChuZXcgU21hcnRDb25uZWN0aW9uc0NoYXRWaWV3KGxlYWYsIHRoaXMpKSk7XHJcbiAgICAvLyBjb2RlLWJsb2NrIHJlbmRlcmVyXHJcbiAgICB0aGlzLnJlZ2lzdGVyTWFya2Rvd25Db2RlQmxvY2tQcm9jZXNzb3IoXCJzbWFydC1jb25uZWN0aW9uc1wiLCB0aGlzLnJlbmRlcl9jb2RlX2Jsb2NrLmJpbmQodGhpcykpO1xyXG5cclxuICAgIC8vIGlmIHRoaXMgc2V0dGluZ3Mudmlld19vcGVuIGlzIHRydWUsIG9wZW4gdmlldyBvbiBzdGFydHVwXHJcbiAgICBpZih0aGlzLnNldHRpbmdzLnZpZXdfb3Blbikge1xyXG4gICAgICB0aGlzLm9wZW5fdmlldygpO1xyXG4gICAgfVxyXG4gICAgLy8gaWYgdGhpcyBzZXR0aW5ncy5jaGF0X29wZW4gaXMgdHJ1ZSwgb3BlbiBjaGF0IG9uIHN0YXJ0dXBcclxuICAgIGlmKHRoaXMuc2V0dGluZ3MuY2hhdF9vcGVuKSB7XHJcbiAgICAgIHRoaXMub3Blbl9jaGF0KCk7XHJcbiAgICB9XHJcbiAgICAvLyBvbiBuZXcgdmVyc2lvblxyXG4gICAgaWYodGhpcy5zZXR0aW5ncy52ZXJzaW9uICE9PSBWRVJTSU9OKSB7XHJcbiAgICAgIHRoaXMuc2V0dGluZ3MuYmVzdF9uZXdfcGx1Z2luID0gZmFsc2U7XHJcbiAgICAgIC8vIHVwZGF0ZSB2ZXJzaW9uXHJcbiAgICAgIHRoaXMuc2V0dGluZ3MudmVyc2lvbiA9IFZFUlNJT047XHJcbiAgICAgIC8vIHNhdmUgc2V0dGluZ3NcclxuICAgICAgYXdhaXQgdGhpcy5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgLy8gb3BlbiB2aWV3XHJcbiAgICAgIHRoaXMub3Blbl92aWV3KCk7XHJcbiAgICB9XHJcbiAgICAvLyBjaGVjayBnaXRodWIgcmVsZWFzZSBlbmRwb2ludCBpZiB1cGRhdGUgaXMgYXZhaWxhYmxlXHJcbiAgICB0aGlzLmFkZF90b19naXRpZ25vcmUoKTtcclxuICAgIC8qKlxyXG4gICAgICogRVhQRVJJTUVOVEFMXHJcbiAgICAgKiAtIHdpbmRvdy1iYXNlZCBBUEkgYWNjZXNzXHJcbiAgICAgKiAtIGNvZGUtYmxvY2sgcmVuZGVyaW5nXHJcbiAgICAgKi9cclxuICAgIHRoaXMuYXBpID0gbmV3IFNjU2VhcmNoQXBpKHRoaXMuYXBwLCB0aGlzKTtcclxuICAgIC8vIHJlZ2lzdGVyIEFQSSB0byBnbG9iYWwgd2luZG93IG9iamVjdFxyXG4gICAgKHdpbmRvd1tcIlNtYXJ0U2VhcmNoQXBpXCJdID0gdGhpcy5hcGkpICYmIHRoaXMucmVnaXN0ZXIoKCkgPT4gZGVsZXRlIHdpbmRvd1tcIlNtYXJ0U2VhcmNoQXBpXCJdKTtcclxuICAgIFxyXG4gIH1cclxuXHJcbiAgYXN5bmMgaW5pdF92ZWNzKCkge1xyXG4gICAgdGhpcy5zbWFydF92ZWNfbGl0ZSA9IG5ldyBWZWNMaXRlKHtcclxuICAgICAgZm9sZGVyX3BhdGg6IFwiLnNtYXJ0LWNvbm5lY3Rpb25zXCIsXHJcbiAgICAgIGV4aXN0c19hZGFwdGVyOiB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLmV4aXN0cy5iaW5kKHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIpLFxyXG4gICAgICBta2Rpcl9hZGFwdGVyOiB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLm1rZGlyLmJpbmQodGhpcy5hcHAudmF1bHQuYWRhcHRlciksXHJcbiAgICAgIHJlYWRfYWRhcHRlcjogdGhpcy5hcHAudmF1bHQuYWRhcHRlci5yZWFkLmJpbmQodGhpcy5hcHAudmF1bHQuYWRhcHRlciksXHJcbiAgICAgIHJlbmFtZV9hZGFwdGVyOiB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLnJlbmFtZS5iaW5kKHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIpLFxyXG4gICAgICBzdGF0X2FkYXB0ZXI6IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIuc3RhdC5iaW5kKHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIpLFxyXG4gICAgICB3cml0ZV9hZGFwdGVyOiB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLndyaXRlLmJpbmQodGhpcy5hcHAudmF1bHQuYWRhcHRlciksXHJcbiAgICB9KTtcclxuICAgIHRoaXMuZW1iZWRkaW5nc19sb2FkZWQgPSBhd2FpdCB0aGlzLnNtYXJ0X3ZlY19saXRlLmxvYWQoKTtcclxuICAgIHJldHVybiB0aGlzLmVtYmVkZGluZ3NfbG9hZGVkO1xyXG4gIH1cclxuICBhc3luYyB1cGdyYWRlKCkge1xyXG4gICAgY29uc3QgdjIgPSBhd2FpdCBPYnNpZGlhbi5yZXF1ZXN0VXJsKHtcclxuICAgICAgdXJsOiBcImh0dHBzOi8vc2MuY29ybi5saS9kb3dubG9hZC9uZXdlc3QuanNvblwiLFxyXG4gICAgICBtZXRob2Q6IFwiR0VUXCIsXHJcbiAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIixcclxuICAgICAgfVxyXG4gICAgfSk7XHJcbiAgICBpZih2Mi5zdGF0dXMgIT09IDIwMCkgdGhyb3cgbmV3IEVycm9yKGBFcnJvciBkb3dubG9hZGluZyB2ZXJzaW9uIDI6IFN0YXR1cyAke3YyLnN0YXR1c31gKTtcclxuICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIud3JpdGUoXCIub2JzaWRpYW4vcGx1Z2lucy9zbWFydC1jb25uZWN0aW9ucy9tYWluLmpzXCIsIHYyLmpzb24ubWFpbik7XHJcbiAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLndyaXRlKFwiLm9ic2lkaWFuL3BsdWdpbnMvc21hcnQtY29ubmVjdGlvbnMvbWFuaWZlc3QuanNvblwiLCB2Mi5qc29uLm1hbmlmZXN0KTtcclxuICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIud3JpdGUoXCIub2JzaWRpYW4vcGx1Z2lucy9zbWFydC1jb25uZWN0aW9ucy9zdHlsZXMuY3NzXCIsIHYyLmpzb24uc3R5bGVzKTtcclxuICAgIC8vIHdpbmRvdy5yZXN0YXJ0X3BsdWdpbih0aGlzLm1hbmlmZXN0LmlkKTtcclxuICAgIGNvbnNvbGUubG9nKCd1cGdyYWRlIGNvbXBsZXRlJyk7XHJcbiAgfVxyXG5cclxuXHJcbiAgYXN5bmMgbG9hZFNldHRpbmdzKCkge1xyXG4gICAgdGhpcy5zZXR0aW5ncyA9IE9iamVjdC5hc3NpZ24oe30sIERFRkFVTFRfU0VUVElOR1MsIGF3YWl0IHRoaXMubG9hZERhdGEoKSk7XHJcbiAgICAvLyBsb2FkIGZpbGUgZXhjbHVzaW9ucyBpZiBub3QgYmxhbmtcclxuICAgIGlmKHRoaXMuc2V0dGluZ3MuZmlsZV9leGNsdXNpb25zICYmIHRoaXMuc2V0dGluZ3MuZmlsZV9leGNsdXNpb25zLmxlbmd0aCA+IDApIHtcclxuICAgICAgLy8gc3BsaXQgZmlsZSBleGNsdXNpb25zIGludG8gYXJyYXkgYW5kIHRyaW0gd2hpdGVzcGFjZVxyXG4gICAgICB0aGlzLmZpbGVfZXhjbHVzaW9ucyA9IHRoaXMuc2V0dGluZ3MuZmlsZV9leGNsdXNpb25zLnNwbGl0KFwiLFwiKS5tYXAoKGZpbGUpID0+IHtcclxuICAgICAgICByZXR1cm4gZmlsZS50cmltKCk7XHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgLy8gbG9hZCBmb2xkZXIgZXhjbHVzaW9ucyBpZiBub3QgYmxhbmtcclxuICAgIGlmKHRoaXMuc2V0dGluZ3MuZm9sZGVyX2V4Y2x1c2lvbnMgJiYgdGhpcy5zZXR0aW5ncy5mb2xkZXJfZXhjbHVzaW9ucy5sZW5ndGggPiAwKSB7XHJcbiAgICAgIC8vIGFkZCBzbGFzaCB0byBlbmQgb2YgZm9sZGVyIG5hbWUgaWYgbm90IHByZXNlbnRcclxuICAgICAgY29uc3QgZm9sZGVyX2V4Y2x1c2lvbnMgPSB0aGlzLnNldHRpbmdzLmZvbGRlcl9leGNsdXNpb25zLnNwbGl0KFwiLFwiKS5tYXAoKGZvbGRlcikgPT4ge1xyXG4gICAgICAgIC8vIHRyaW0gd2hpdGVzcGFjZVxyXG4gICAgICAgIGZvbGRlciA9IGZvbGRlci50cmltKCk7XHJcbiAgICAgICAgaWYoZm9sZGVyLnNsaWNlKC0xKSAhPT0gXCIvXCIpIHtcclxuICAgICAgICAgIHJldHVybiBmb2xkZXIgKyBcIi9cIjtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgcmV0dXJuIGZvbGRlcjtcclxuICAgICAgICB9XHJcbiAgICAgIH0pO1xyXG4gICAgICAvLyBtZXJnZSBmb2xkZXIgZXhjbHVzaW9ucyB3aXRoIGZpbGUgZXhjbHVzaW9uc1xyXG4gICAgICB0aGlzLmZpbGVfZXhjbHVzaW9ucyA9IHRoaXMuZmlsZV9leGNsdXNpb25zLmNvbmNhdChmb2xkZXJfZXhjbHVzaW9ucyk7XHJcbiAgICB9XHJcbiAgICAvLyBsb2FkIGhlYWRlciBleGNsdXNpb25zIGlmIG5vdCBibGFua1xyXG4gICAgaWYodGhpcy5zZXR0aW5ncy5oZWFkZXJfZXhjbHVzaW9ucyAmJiB0aGlzLnNldHRpbmdzLmhlYWRlcl9leGNsdXNpb25zLmxlbmd0aCA+IDApIHtcclxuICAgICAgdGhpcy5oZWFkZXJfZXhjbHVzaW9ucyA9IHRoaXMuc2V0dGluZ3MuaGVhZGVyX2V4Y2x1c2lvbnMuc3BsaXQoXCIsXCIpLm1hcCgoaGVhZGVyKSA9PiB7XHJcbiAgICAgICAgcmV0dXJuIGhlYWRlci50cmltKCk7XHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgLy8gbG9hZCBwYXRoX29ubHkgaWYgbm90IGJsYW5rXHJcbiAgICBpZih0aGlzLnNldHRpbmdzLnBhdGhfb25seSAmJiB0aGlzLnNldHRpbmdzLnBhdGhfb25seS5sZW5ndGggPiAwKSB7XHJcbiAgICAgIHRoaXMucGF0aF9vbmx5ID0gdGhpcy5zZXR0aW5ncy5wYXRoX29ubHkuc3BsaXQoXCIsXCIpLm1hcCgocGF0aCkgPT4ge1xyXG4gICAgICAgIHJldHVybiBwYXRoLnRyaW0oKTtcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICAvLyBsb2FkIHNlbGZfcmVmX2t3X3JlZ2V4XHJcbiAgICAvLyB0aGlzLnNlbGZfcmVmX2t3X3JlZ2V4ID0gbmV3IFJlZ0V4cChgKCR7U01BUlRfVFJBTlNMQVRJT05bdGhpcy5zZXR0aW5ncy5sYW5ndWFnZV0ucHJvbm91cy5qb2luKFwifFwiKX0pYCwgXCJnaVwiKTtcclxuICAgIC8vIGxvYWQgZmFpbGVkIGZpbGVzXHJcbiAgICBhd2FpdCB0aGlzLmxvYWRfZmFpbGVkX2ZpbGVzKCk7XHJcbiAgfVxyXG4gIGFzeW5jIHNhdmVTZXR0aW5ncyhyZXJlbmRlcj1mYWxzZSkge1xyXG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YSh0aGlzLnNldHRpbmdzKTtcclxuICAgIC8vIHJlLWxvYWQgc2V0dGluZ3MgaW50byBtZW1vcnlcclxuICAgIGF3YWl0IHRoaXMubG9hZFNldHRpbmdzKCk7XHJcbiAgICAvLyByZS1yZW5kZXIgdmlldyBpZiBzZXQgdG8gdHJ1ZSAoZm9yIGV4YW1wbGUsIGFmdGVyIGFkZGluZyBBUEkga2V5KVxyXG4gICAgaWYocmVyZW5kZXIpIHtcclxuICAgICAgdGhpcy5uZWFyZXN0X2NhY2hlID0ge307XHJcbiAgICAgIGF3YWl0IHRoaXMubWFrZV9jb25uZWN0aW9ucygpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLy8gY2hlY2sgZm9yIHVwZGF0ZVxyXG4gIGFzeW5jIGNoZWNrX2Zvcl91cGRhdGUoKSB7XHJcbiAgICAvLyBmYWlsIHNpbGVudGx5LCBleC4gaWYgbm8gaW50ZXJuZXQgY29ubmVjdGlvblxyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gZ2V0IGxhdGVzdCByZWxlYXNlIHZlcnNpb24gZnJvbSBnaXRodWJcclxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCAoMCwgT2JzaWRpYW4ucmVxdWVzdFVybCkoe1xyXG4gICAgICAgIHVybDogXCJodHRwczovL2FwaS5naXRodWIuY29tL3JlcG9zL2JyaWFucGV0cm8vb2JzaWRpYW4tc21hcnQtY29ubmVjdGlvbnMvcmVsZWFzZXMvbGF0ZXN0XCIsXHJcbiAgICAgICAgbWV0aG9kOiBcIkdFVFwiLFxyXG4gICAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgY29udGVudFR5cGU6IFwiYXBwbGljYXRpb24vanNvblwiLFxyXG4gICAgICB9KTtcclxuICAgICAgLy8gZ2V0IHZlcnNpb24gbnVtYmVyIGZyb20gcmVzcG9uc2VcclxuICAgICAgY29uc3QgbGF0ZXN0X3JlbGVhc2UgPSBKU09OLnBhcnNlKHJlc3BvbnNlLnRleHQpLnRhZ19uYW1lO1xyXG4gICAgICAvLyBjb25zb2xlLmxvZyhgTGF0ZXN0IHJlbGVhc2U6ICR7bGF0ZXN0X3JlbGVhc2V9YCk7XHJcbiAgICAgIC8vIGlmIGxhdGVzdF9yZWxlYXNlIGlzIG5ld2VyIHRoYW4gY3VycmVudCB2ZXJzaW9uLCBzaG93IG1lc3NhZ2VcclxuICAgICAgaWYobGF0ZXN0X3JlbGVhc2UgIT09IFZFUlNJT04pIHtcclxuICAgICAgICBuZXcgT2JzaWRpYW4uTm90aWNlKGBbU21hcnQgQ29ubmVjdGlvbnNdIEEgbmV3IHZlcnNpb24gaXMgYXZhaWxhYmxlISAodiR7bGF0ZXN0X3JlbGVhc2V9KWApO1xyXG4gICAgICAgIHRoaXMudXBkYXRlX2F2YWlsYWJsZSA9IHRydWU7XHJcbiAgICAgICAgdGhpcy5yZW5kZXJfYnJhbmQoXCJhbGxcIilcclxuICAgICAgfVxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5sb2coZXJyb3IpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgcmVuZGVyX2NvZGVfYmxvY2soY29udGVudHMsIGNvbnRhaW5lciwgY3R4KSB7XHJcbiAgICBsZXQgbmVhcmVzdDtcclxuICAgIGlmKGNvbnRlbnRzLnRyaW0oKS5sZW5ndGggPiAwKSB7XHJcbiAgICAgIG5lYXJlc3QgPSBhd2FpdCB0aGlzLmFwaS5zZWFyY2goY29udGVudHMpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgLy8gdXNlIGN0eCB0byBnZXQgZmlsZVxyXG4gICAgICBjb25zb2xlLmxvZyhjdHgpO1xyXG4gICAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGN0eC5zb3VyY2VQYXRoKTtcclxuICAgICAgbmVhcmVzdCA9IGF3YWl0IHRoaXMuZmluZF9ub3RlX2Nvbm5lY3Rpb25zKGZpbGUpO1xyXG4gICAgfVxyXG4gICAgaWYgKG5lYXJlc3QubGVuZ3RoKSB7XHJcbiAgICAgIHRoaXMudXBkYXRlX3Jlc3VsdHMoY29udGFpbmVyLCBuZWFyZXN0KTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIG1ha2VfY29ubmVjdGlvbnMoc2VsZWN0ZWRfdGV4dD1udWxsKSB7XHJcbiAgICBsZXQgdmlldyA9IHRoaXMuZ2V0X3ZpZXcoKTtcclxuICAgIGlmICghdmlldykge1xyXG4gICAgICAvLyBvcGVuIHZpZXcgaWYgbm90IG9wZW5cclxuICAgICAgYXdhaXQgdGhpcy5vcGVuX3ZpZXcoKTtcclxuICAgICAgdmlldyA9IHRoaXMuZ2V0X3ZpZXcoKTtcclxuICAgIH1cclxuICAgIGF3YWl0IHZpZXcucmVuZGVyX2Nvbm5lY3Rpb25zKHNlbGVjdGVkX3RleHQpO1xyXG4gIH1cclxuXHJcbiAgYWRkSWNvbigpe1xyXG4gICAgT2JzaWRpYW4uYWRkSWNvbihcInNtYXJ0LWNvbm5lY3Rpb25zXCIsIGA8cGF0aCBkPVwiTTUwLDIwIEw4MCw0MCBMODAsNjAgTDUwLDEwMFwiIHN0cm9rZT1cImN1cnJlbnRDb2xvclwiIHN0cm9rZS13aWR0aD1cIjRcIiBmaWxsPVwibm9uZVwiLz5cclxuICAgIDxwYXRoIGQ9XCJNMzAsNTAgTDU1LDcwXCIgc3Ryb2tlPVwiY3VycmVudENvbG9yXCIgc3Ryb2tlLXdpZHRoPVwiNVwiIGZpbGw9XCJub25lXCIvPlxyXG4gICAgPGNpcmNsZSBjeD1cIjUwXCIgY3k9XCIyMFwiIHI9XCI5XCIgZmlsbD1cImN1cnJlbnRDb2xvclwiLz5cclxuICAgIDxjaXJjbGUgY3g9XCI4MFwiIGN5PVwiNDBcIiByPVwiOVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIi8+XHJcbiAgICA8Y2lyY2xlIGN4PVwiODBcIiBjeT1cIjcwXCIgcj1cIjlcIiBmaWxsPVwiY3VycmVudENvbG9yXCIvPlxyXG4gICAgPGNpcmNsZSBjeD1cIjUwXCIgY3k9XCIxMDBcIiByPVwiOVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIi8+XHJcbiAgICA8Y2lyY2xlIGN4PVwiMzBcIiBjeT1cIjUwXCIgcj1cIjlcIiBmaWxsPVwiY3VycmVudENvbG9yXCIvPmApO1xyXG4gIH1cclxuXHJcbiAgLy8gb3BlbiByYW5kb20gbm90ZVxyXG4gIGFzeW5jIG9wZW5fcmFuZG9tX25vdGUoKSB7XHJcbiAgICBjb25zdCBjdXJyX2ZpbGUgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpO1xyXG4gICAgY29uc3QgY3Vycl9rZXkgPSBtZDUoY3Vycl9maWxlLnBhdGgpO1xyXG4gICAgLy8gaWYgbm8gbmVhcmVzdCBjYWNoZSwgY3JlYXRlIE9ic2lkaWFuIG5vdGljZVxyXG4gICAgaWYodHlwZW9mIHRoaXMubmVhcmVzdF9jYWNoZVtjdXJyX2tleV0gPT09IFwidW5kZWZpbmVkXCIpIHtcclxuICAgICAgbmV3IE9ic2lkaWFuLk5vdGljZShcIltTbWFydCBDb25uZWN0aW9uc10gTm8gU21hcnQgQ29ubmVjdGlvbnMgZm91bmQuIE9wZW4gYSBub3RlIHRvIGdldCBTbWFydCBDb25uZWN0aW9ucy5cIik7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIC8vIGdldCByYW5kb20gZnJvbSBuZWFyZXN0IGNhY2hlXHJcbiAgICBjb25zdCByYW5kID0gTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogdGhpcy5uZWFyZXN0X2NhY2hlW2N1cnJfa2V5XS5sZW5ndGgvMik7IC8vIGRpdmlkZSBieSAyIHRvIGxpbWl0IHRvIHRvcCBoYWxmIG9mIHJlc3VsdHNcclxuICAgIGNvbnN0IHJhbmRvbV9maWxlID0gdGhpcy5uZWFyZXN0X2NhY2hlW2N1cnJfa2V5XVtyYW5kXTtcclxuICAgIC8vIG9wZW4gcmFuZG9tIGZpbGVcclxuICAgIHRoaXMub3Blbl9ub3RlKHJhbmRvbV9maWxlKTtcclxuICB9XHJcblxyXG4gIGFzeW5jIG9wZW5fdmlldygpIHtcclxuICAgIGlmKHRoaXMuZ2V0X3ZpZXcoKSl7XHJcbiAgICAgIGNvbnNvbGUubG9nKFwiU21hcnQgQ29ubmVjdGlvbnMgdmlldyBhbHJlYWR5IG9wZW5cIik7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5kZXRhY2hMZWF2ZXNPZlR5cGUoU01BUlRfQ09OTkVDVElPTlNfVklFV19UWVBFKTtcclxuICAgIGF3YWl0IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRSaWdodExlYWYoZmFsc2UpLnNldFZpZXdTdGF0ZSh7XHJcbiAgICAgIHR5cGU6IFNNQVJUX0NPTk5FQ1RJT05TX1ZJRVdfVFlQRSxcclxuICAgICAgYWN0aXZlOiB0cnVlLFxyXG4gICAgfSk7XHJcbiAgICB0aGlzLmFwcC53b3Jrc3BhY2UucmV2ZWFsTGVhZihcclxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShTTUFSVF9DT05ORUNUSU9OU19WSUVXX1RZUEUpWzBdXHJcbiAgICApO1xyXG4gIH1cclxuICAvLyBzb3VyY2U6IGh0dHBzOi8vZ2l0aHViLmNvbS9vYnNpZGlhbm1kL29ic2lkaWFuLXJlbGVhc2VzL2Jsb2IvbWFzdGVyL3BsdWdpbi1yZXZpZXcubWQjYXZvaWQtbWFuYWdpbmctcmVmZXJlbmNlcy10by1jdXN0b20tdmlld3NcclxuICBnZXRfdmlldygpIHtcclxuICAgIGZvciAobGV0IGxlYWYgb2YgdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShTTUFSVF9DT05ORUNUSU9OU19WSUVXX1RZUEUpKSB7XHJcbiAgICAgIGlmIChsZWFmLnZpZXcgaW5zdGFuY2VvZiBTbWFydENvbm5lY3Rpb25zVmlldykge1xyXG4gICAgICAgIHJldHVybiBsZWFmLnZpZXc7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcbiAgLy8gb3BlbiBjaGF0IHZpZXdcclxuICBhc3luYyBvcGVuX2NoYXQocmV0cmllcz0wKSB7XHJcbiAgICBpZighdGhpcy5lbWJlZGRpbmdzX2xvYWRlZCkge1xyXG4gICAgICBjb25zb2xlLmxvZyhcImVtYmVkZGluZ3Mgbm90IGxvYWRlZCB5ZXRcIik7XHJcbiAgICAgIGlmKHJldHJpZXMgPCAzKSB7XHJcbiAgICAgICAgLy8gd2FpdCBhbmQgdHJ5IGFnYWluXHJcbiAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgICAgICB0aGlzLm9wZW5fY2hhdChyZXRyaWVzKzEpO1xyXG4gICAgICAgIH0sIDEwMDAgKiAocmV0cmllcysxKSk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcbiAgICAgIGNvbnNvbGUubG9nKFwiZW1iZWRkaW5ncyBzdGlsbCBub3QgbG9hZGVkLCBvcGVuaW5nIHNtYXJ0IHZpZXdcIik7XHJcbiAgICAgIHRoaXMub3Blbl92aWV3KCk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5kZXRhY2hMZWF2ZXNPZlR5cGUoU01BUlRfQ09OTkVDVElPTlNfQ0hBVF9WSUVXX1RZUEUpO1xyXG4gICAgYXdhaXQgdGhpcy5hcHAud29ya3NwYWNlLmdldFJpZ2h0TGVhZihmYWxzZSkuc2V0Vmlld1N0YXRlKHtcclxuICAgICAgdHlwZTogU01BUlRfQ09OTkVDVElPTlNfQ0hBVF9WSUVXX1RZUEUsXHJcbiAgICAgIGFjdGl2ZTogdHJ1ZSxcclxuICAgIH0pO1xyXG4gICAgdGhpcy5hcHAud29ya3NwYWNlLnJldmVhbExlYWYoXHJcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoU01BUlRfQ09OTkVDVElPTlNfQ0hBVF9WSUVXX1RZUEUpWzBdXHJcbiAgICApO1xyXG4gIH1cclxuICBcclxuICAvLyBnZXQgZW1iZWRkaW5ncyBmb3IgYWxsIGZpbGVzXHJcbiAgYXN5bmMgZ2V0X2FsbF9lbWJlZGRpbmdzKCkge1xyXG4gICAgLy8gZ2V0IGFsbCBmaWxlcyBpbiB2YXVsdCBhbmQgZmlsdGVyIGFsbCBidXQgbWFya2Rvd24gYW5kIGNhbnZhcyBmaWxlc1xyXG4gICAgY29uc3QgZmlsZXMgPSAoYXdhaXQgdGhpcy5hcHAudmF1bHQuZ2V0RmlsZXMoKSkuZmlsdGVyKChmaWxlKSA9PiBmaWxlIGluc3RhbmNlb2YgT2JzaWRpYW4uVEZpbGUgJiYgKGZpbGUuZXh0ZW5zaW9uID09PSBcIm1kXCIgfHwgZmlsZS5leHRlbnNpb24gPT09IFwiY2FudmFzXCIpKTtcclxuICAgIC8vIGNvbnN0IGZpbGVzID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpO1xyXG4gICAgLy8gZ2V0IG9wZW4gZmlsZXMgdG8gc2tpcCBpZiBmaWxlIGlzIGN1cnJlbnRseSBvcGVuXHJcbiAgICBjb25zdCBvcGVuX2ZpbGVzID0gdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcIm1hcmtkb3duXCIpLm1hcCgobGVhZikgPT4gbGVhZi52aWV3LmZpbGUpO1xyXG4gICAgY29uc3QgY2xlYW5fdXBfbG9nID0gdGhpcy5zbWFydF92ZWNfbGl0ZS5jbGVhbl91cF9lbWJlZGRpbmdzKGZpbGVzKTtcclxuICAgIGlmKHRoaXMuc2V0dGluZ3MubG9nX3JlbmRlcil7XHJcbiAgICAgIHRoaXMucmVuZGVyX2xvZy50b3RhbF9maWxlcyA9IGZpbGVzLmxlbmd0aDtcclxuICAgICAgdGhpcy5yZW5kZXJfbG9nLmRlbGV0ZWRfZW1iZWRkaW5ncyA9IGNsZWFuX3VwX2xvZy5kZWxldGVkX2VtYmVkZGluZ3M7XHJcbiAgICAgIHRoaXMucmVuZGVyX2xvZy50b3RhbF9lbWJlZGRpbmdzID0gY2xlYW5fdXBfbG9nLnRvdGFsX2VtYmVkZGluZ3M7XHJcbiAgICB9XHJcbiAgICAvLyBiYXRjaCBlbWJlZGRpbmdzXHJcbiAgICBsZXQgYmF0Y2hfcHJvbWlzZXMgPSBbXTtcclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZmlsZXMubGVuZ3RoOyBpKyspIHtcclxuICAgICAgLy8gc2tpcCBpZiBwYXRoIGNvbnRhaW5zIGEgI1xyXG4gICAgICBpZihmaWxlc1tpXS5wYXRoLmluZGV4T2YoXCIjXCIpID4gLTEpIHtcclxuICAgICAgICAvLyBjb25zb2xlLmxvZyhcInNraXBwaW5nIGZpbGUgJ1wiK2ZpbGVzW2ldLnBhdGgrXCInIChwYXRoIGNvbnRhaW5zICMpXCIpO1xyXG4gICAgICAgIHRoaXMubG9nX2V4Y2x1c2lvbihcInBhdGggY29udGFpbnMgI1wiKTtcclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG4gICAgICAvLyBza2lwIGlmIGZpbGUgYWxyZWFkeSBoYXMgZW1iZWRkaW5nIGFuZCBlbWJlZGRpbmcubXRpbWUgaXMgZ3JlYXRlciB0aGFuIG9yIGVxdWFsIHRvIGZpbGUubXRpbWVcclxuICAgICAgaWYodGhpcy5zbWFydF92ZWNfbGl0ZS5tdGltZV9pc19jdXJyZW50KG1kNShmaWxlc1tpXS5wYXRoKSwgZmlsZXNbaV0uc3RhdC5tdGltZSkpIHtcclxuICAgICAgICAvLyBsb2cgc2tpcHBpbmcgZmlsZVxyXG4gICAgICAgIC8vIGNvbnNvbGUubG9nKFwic2tpcHBpbmcgZmlsZSAobXRpbWUpXCIpO1xyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcbiAgICAgIC8vIGNoZWNrIGlmIGZpbGUgaXMgaW4gZmFpbGVkX2ZpbGVzXHJcbiAgICAgIGlmKHRoaXMuc2V0dGluZ3MuZmFpbGVkX2ZpbGVzLmluZGV4T2YoZmlsZXNbaV0ucGF0aCkgPiAtMSkge1xyXG4gICAgICAgIC8vIGxvZyBza2lwcGluZyBmaWxlXHJcbiAgICAgICAgLy8gY29uc29sZS5sb2coXCJza2lwcGluZyBwcmV2aW91c2x5IGZhaWxlZCBmaWxlLCB1c2UgYnV0dG9uIGluIHNldHRpbmdzIHRvIHJldHJ5XCIpO1xyXG4gICAgICAgIC8vIHVzZSBzZXRUaW1lb3V0IHRvIHByZXZlbnQgbXVsdGlwbGUgbm90aWNlc1xyXG4gICAgICAgIGlmKHRoaXMucmV0cnlfbm90aWNlX3RpbWVvdXQpIHtcclxuICAgICAgICAgIGNsZWFyVGltZW91dCh0aGlzLnJldHJ5X25vdGljZV90aW1lb3V0KTtcclxuICAgICAgICAgIHRoaXMucmV0cnlfbm90aWNlX3RpbWVvdXQgPSBudWxsO1xyXG4gICAgICAgIH1cclxuICAgICAgICAvLyBsaW1pdCB0byBvbmUgbm90aWNlIGV2ZXJ5IDEwIG1pbnV0ZXNcclxuICAgICAgICBpZighdGhpcy5yZWNlbnRseV9zZW50X3JldHJ5X25vdGljZSl7XHJcbiAgICAgICAgICBuZXcgT2JzaWRpYW4uTm90aWNlKFwiU21hcnQgQ29ubmVjdGlvbnM6IFNraXBwaW5nIHByZXZpb3VzbHkgZmFpbGVkIGZpbGUsIHVzZSBidXR0b24gaW4gc2V0dGluZ3MgdG8gcmV0cnlcIik7XHJcbiAgICAgICAgICB0aGlzLnJlY2VudGx5X3NlbnRfcmV0cnlfbm90aWNlID0gdHJ1ZTtcclxuICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgICAgICB0aGlzLnJlY2VudGx5X3NlbnRfcmV0cnlfbm90aWNlID0gZmFsc2U7ICBcclxuICAgICAgICAgIH0sIDYwMDAwMCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcbiAgICAgIC8vIHNraXAgZmlsZXMgd2hlcmUgcGF0aCBjb250YWlucyBhbnkgZXhjbHVzaW9uc1xyXG4gICAgICBsZXQgc2tpcCA9IGZhbHNlO1xyXG4gICAgICBmb3IobGV0IGogPSAwOyBqIDwgdGhpcy5maWxlX2V4Y2x1c2lvbnMubGVuZ3RoOyBqKyspIHtcclxuICAgICAgICBpZihmaWxlc1tpXS5wYXRoLmluZGV4T2YodGhpcy5maWxlX2V4Y2x1c2lvbnNbal0pID4gLTEpIHtcclxuICAgICAgICAgIHNraXAgPSB0cnVlO1xyXG4gICAgICAgICAgdGhpcy5sb2dfZXhjbHVzaW9uKHRoaXMuZmlsZV9leGNsdXNpb25zW2pdKTtcclxuICAgICAgICAgIC8vIGJyZWFrIG91dCBvZiBsb29wXHJcbiAgICAgICAgICBicmVhaztcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgaWYoc2tpcCkge1xyXG4gICAgICAgIGNvbnRpbnVlOyAvLyB0byBuZXh0IGZpbGVcclxuICAgICAgfVxyXG4gICAgICAvLyBjaGVjayBpZiBmaWxlIGlzIG9wZW5cclxuICAgICAgaWYob3Blbl9maWxlcy5pbmRleE9mKGZpbGVzW2ldKSA+IC0xKSB7XHJcbiAgICAgICAgLy8gY29uc29sZS5sb2coXCJza2lwcGluZyBmaWxlIChvcGVuKVwiKTtcclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG4gICAgICB0cnkge1xyXG4gICAgICAgIC8vIHB1c2ggcHJvbWlzZSB0byBiYXRjaF9wcm9taXNlc1xyXG4gICAgICAgIGJhdGNoX3Byb21pc2VzLnB1c2godGhpcy5nZXRfZmlsZV9lbWJlZGRpbmdzKGZpbGVzW2ldLCBmYWxzZSkpO1xyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGVycm9yKTtcclxuICAgICAgfVxyXG4gICAgICAvLyBpZiBiYXRjaF9wcm9taXNlcyBsZW5ndGggaXMgMTBcclxuICAgICAgaWYoYmF0Y2hfcHJvbWlzZXMubGVuZ3RoID4gMykge1xyXG4gICAgICAgIC8vIHdhaXQgZm9yIGFsbCBwcm9taXNlcyB0byByZXNvbHZlXHJcbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoYmF0Y2hfcHJvbWlzZXMpO1xyXG4gICAgICAgIC8vIGNsZWFyIGJhdGNoX3Byb21pc2VzXHJcbiAgICAgICAgYmF0Y2hfcHJvbWlzZXMgPSBbXTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gc2F2ZSBlbWJlZGRpbmdzIEpTT04gdG8gZmlsZSBldmVyeSAxMDAgZmlsZXMgdG8gc2F2ZSBwcm9ncmVzcyBvbiBidWxrIGVtYmVkZGluZ1xyXG4gICAgICBpZihpID4gMCAmJiBpICUgMTAwID09PSAwKSB7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5zYXZlX2VtYmVkZGluZ3NfdG9fZmlsZSgpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICAvLyB3YWl0IGZvciBhbGwgcHJvbWlzZXMgdG8gcmVzb2x2ZVxyXG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoYmF0Y2hfcHJvbWlzZXMpO1xyXG4gICAgLy8gd3JpdGUgZW1iZWRkaW5ncyBKU09OIHRvIGZpbGVcclxuICAgIGF3YWl0IHRoaXMuc2F2ZV9lbWJlZGRpbmdzX3RvX2ZpbGUoKTtcclxuICAgIC8vIGlmIHJlbmRlcl9sb2cuZmFpbGVkX2VtYmVkZGluZ3MgdGhlbiB1cGRhdGUgZmFpbGVkX2VtYmVkZGluZ3MudHh0XHJcbiAgICBpZih0aGlzLnJlbmRlcl9sb2cuZmFpbGVkX2VtYmVkZGluZ3MubGVuZ3RoID4gMCkge1xyXG4gICAgICBhd2FpdCB0aGlzLnNhdmVfZmFpbGVkX2VtYmVkZGluZ3MoKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIHNhdmVfZW1iZWRkaW5nc190b19maWxlKGZvcmNlPWZhbHNlKSB7XHJcbiAgICBpZighdGhpcy5oYXNfbmV3X2VtYmVkZGluZ3Mpe1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICAvLyBjb25zb2xlLmxvZyhcIm5ldyBlbWJlZGRpbmdzLCBzYXZpbmcgdG8gZmlsZVwiKTtcclxuICAgIGlmKCFmb3JjZSkge1xyXG4gICAgICAvLyBwcmV2ZW50IGV4Y2Vzc2l2ZSB3cml0ZXMgdG8gZW1iZWRkaW5ncyBmaWxlIGJ5IHdhaXRpbmcgMSBtaW51dGUgYmVmb3JlIHdyaXRpbmdcclxuICAgICAgaWYodGhpcy5zYXZlX3RpbWVvdXQpIHtcclxuICAgICAgICBjbGVhclRpbWVvdXQodGhpcy5zYXZlX3RpbWVvdXQpO1xyXG4gICAgICAgIHRoaXMuc2F2ZV90aW1lb3V0ID0gbnVsbDsgIFxyXG4gICAgICB9XHJcbiAgICAgIHRoaXMuc2F2ZV90aW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgICAgLy8gY29uc29sZS5sb2coXCJ3cml0aW5nIGVtYmVkZGluZ3MgdG8gZmlsZVwiKTtcclxuICAgICAgICB0aGlzLnNhdmVfZW1iZWRkaW5nc190b19maWxlKHRydWUpO1xyXG4gICAgICAgIC8vIGNsZWFyIHRpbWVvdXRcclxuICAgICAgICBpZih0aGlzLnNhdmVfdGltZW91dCkge1xyXG4gICAgICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuc2F2ZV90aW1lb3V0KTtcclxuICAgICAgICAgIHRoaXMuc2F2ZV90aW1lb3V0ID0gbnVsbDtcclxuICAgICAgICB9XHJcbiAgICAgIH0sIDMwMDAwKTtcclxuICAgICAgY29uc29sZS5sb2coXCJzY2hlZHVsZWQgc2F2ZVwiKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIHRyeXtcclxuICAgICAgLy8gdXNlIHNtYXJ0X3ZlY19saXRlXHJcbiAgICAgIGF3YWl0IHRoaXMuc21hcnRfdmVjX2xpdGUuc2F2ZSgpO1xyXG4gICAgICB0aGlzLmhhc19uZXdfZW1iZWRkaW5ncyA9IGZhbHNlO1xyXG4gICAgfWNhdGNoKGVycm9yKXtcclxuICAgICAgY29uc29sZS5sb2coZXJyb3IpO1xyXG4gICAgICBuZXcgT2JzaWRpYW4uTm90aWNlKFwiU21hcnQgQ29ubmVjdGlvbnM6IFwiK2Vycm9yLm1lc3NhZ2UpO1xyXG4gICAgfVxyXG5cclxuICB9XHJcbiAgLy8gc2F2ZSBmYWlsZWQgZW1iZWRkaW5ncyB0byBmaWxlIGZyb20gcmVuZGVyX2xvZy5mYWlsZWRfZW1iZWRkaW5nc1xyXG4gIGFzeW5jIHNhdmVfZmFpbGVkX2VtYmVkZGluZ3MgKCkge1xyXG4gICAgLy8gd3JpdGUgZmFpbGVkX2VtYmVkZGluZ3MgdG8gZmlsZSBvbmUgbGluZSBwZXIgZmFpbGVkIGVtYmVkZGluZ1xyXG4gICAgbGV0IGZhaWxlZF9lbWJlZGRpbmdzID0gW107XHJcbiAgICAvLyBpZiBmaWxlIGFscmVhZHkgZXhpc3RzIHRoZW4gcmVhZCBpdFxyXG4gICAgY29uc3QgZmFpbGVkX2VtYmVkZGluZ3NfZmlsZV9leGlzdHMgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLmV4aXN0cyhcIi5zbWFydC1jb25uZWN0aW9ucy9mYWlsZWQtZW1iZWRkaW5ncy50eHRcIik7XHJcbiAgICBpZihmYWlsZWRfZW1iZWRkaW5nc19maWxlX2V4aXN0cykge1xyXG4gICAgICBmYWlsZWRfZW1iZWRkaW5ncyA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIucmVhZChcIi5zbWFydC1jb25uZWN0aW9ucy9mYWlsZWQtZW1iZWRkaW5ncy50eHRcIik7XHJcbiAgICAgIC8vIHNwbGl0IGZhaWxlZF9lbWJlZGRpbmdzIGludG8gYXJyYXlcclxuICAgICAgZmFpbGVkX2VtYmVkZGluZ3MgPSBmYWlsZWRfZW1iZWRkaW5ncy5zcGxpdChcIlxcclxcblwiKTtcclxuICAgIH1cclxuICAgIC8vIG1lcmdlIGZhaWxlZF9lbWJlZGRpbmdzIHdpdGggcmVuZGVyX2xvZy5mYWlsZWRfZW1iZWRkaW5nc1xyXG4gICAgZmFpbGVkX2VtYmVkZGluZ3MgPSBmYWlsZWRfZW1iZWRkaW5ncy5jb25jYXQodGhpcy5yZW5kZXJfbG9nLmZhaWxlZF9lbWJlZGRpbmdzKTtcclxuICAgIC8vIHJlbW92ZSBkdXBsaWNhdGVzXHJcbiAgICBmYWlsZWRfZW1iZWRkaW5ncyA9IFsuLi5uZXcgU2V0KGZhaWxlZF9lbWJlZGRpbmdzKV07XHJcbiAgICAvLyBzb3J0IGZhaWxlZF9lbWJlZGRpbmdzIGFycmF5IGFscGhhYmV0aWNhbGx5XHJcbiAgICBmYWlsZWRfZW1iZWRkaW5ncy5zb3J0KCk7XHJcbiAgICAvLyBjb252ZXJ0IGZhaWxlZF9lbWJlZGRpbmdzIGFycmF5IHRvIHN0cmluZ1xyXG4gICAgZmFpbGVkX2VtYmVkZGluZ3MgPSBmYWlsZWRfZW1iZWRkaW5ncy5qb2luKFwiXFxyXFxuXCIpO1xyXG4gICAgLy8gd3JpdGUgZmFpbGVkX2VtYmVkZGluZ3MgdG8gZmlsZVxyXG4gICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci53cml0ZShcIi5zbWFydC1jb25uZWN0aW9ucy9mYWlsZWQtZW1iZWRkaW5ncy50eHRcIiwgZmFpbGVkX2VtYmVkZGluZ3MpO1xyXG4gICAgLy8gcmVsb2FkIGZhaWxlZF9lbWJlZGRpbmdzIHRvIHByZXZlbnQgcmV0cnlpbmcgZmFpbGVkIGZpbGVzIHVudGlsIGV4cGxpY2l0bHkgcmVxdWVzdGVkXHJcbiAgICBhd2FpdCB0aGlzLmxvYWRfZmFpbGVkX2ZpbGVzKCk7XHJcbiAgfVxyXG4gIFxyXG4gIC8vIGxvYWQgZmFpbGVkIGZpbGVzIGZyb20gZmFpbGVkLWVtYmVkZGluZ3MudHh0XHJcbiAgYXN5bmMgbG9hZF9mYWlsZWRfZmlsZXMgKCkge1xyXG4gICAgLy8gY2hlY2sgaWYgZmFpbGVkLWVtYmVkZGluZ3MudHh0IGV4aXN0c1xyXG4gICAgY29uc3QgZmFpbGVkX2VtYmVkZGluZ3NfZmlsZV9leGlzdHMgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLmV4aXN0cyhcIi5zbWFydC1jb25uZWN0aW9ucy9mYWlsZWQtZW1iZWRkaW5ncy50eHRcIik7XHJcbiAgICBpZighZmFpbGVkX2VtYmVkZGluZ3NfZmlsZV9leGlzdHMpIHtcclxuICAgICAgdGhpcy5zZXR0aW5ncy5mYWlsZWRfZmlsZXMgPSBbXTtcclxuICAgICAgY29uc29sZS5sb2coXCJObyBmYWlsZWQgZmlsZXMuXCIpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICAvLyByZWFkIGZhaWxlZC1lbWJlZGRpbmdzLnR4dFxyXG4gICAgY29uc3QgZmFpbGVkX2VtYmVkZGluZ3MgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLnJlYWQoXCIuc21hcnQtY29ubmVjdGlvbnMvZmFpbGVkLWVtYmVkZGluZ3MudHh0XCIpO1xyXG4gICAgLy8gc3BsaXQgZmFpbGVkX2VtYmVkZGluZ3MgaW50byBhcnJheSBhbmQgcmVtb3ZlIGVtcHR5IGxpbmVzXHJcbiAgICBjb25zdCBmYWlsZWRfZW1iZWRkaW5nc19hcnJheSA9IGZhaWxlZF9lbWJlZGRpbmdzLnNwbGl0KFwiXFxyXFxuXCIpO1xyXG4gICAgLy8gc3BsaXQgYXQgJyMnIGFuZCByZWR1Y2UgaW50byB1bmlxdWUgZmlsZSBwYXRoc1xyXG4gICAgY29uc3QgZmFpbGVkX2ZpbGVzID0gZmFpbGVkX2VtYmVkZGluZ3NfYXJyYXkubWFwKGVtYmVkZGluZyA9PiBlbWJlZGRpbmcuc3BsaXQoXCIjXCIpWzBdKS5yZWR1Y2UoKHVuaXF1ZSwgaXRlbSkgPT4gdW5pcXVlLmluY2x1ZGVzKGl0ZW0pID8gdW5pcXVlIDogWy4uLnVuaXF1ZSwgaXRlbV0sIFtdKTtcclxuICAgIC8vIHJldHVybiBmYWlsZWRfZmlsZXNcclxuICAgIHRoaXMuc2V0dGluZ3MuZmFpbGVkX2ZpbGVzID0gZmFpbGVkX2ZpbGVzO1xyXG4gICAgLy8gY29uc29sZS5sb2coZmFpbGVkX2ZpbGVzKTtcclxuICB9XHJcbiAgLy8gcmV0cnkgZmFpbGVkIGVtYmVkZGluZ3NcclxuICBhc3luYyByZXRyeV9mYWlsZWRfZmlsZXMgKCkge1xyXG4gICAgLy8gcmVtb3ZlIGZhaWxlZCBmaWxlcyBmcm9tIGZhaWxlZF9maWxlc1xyXG4gICAgdGhpcy5zZXR0aW5ncy5mYWlsZWRfZmlsZXMgPSBbXTtcclxuICAgIC8vIGlmIGZhaWxlZC1lbWJlZGRpbmdzLnR4dCBleGlzdHMgdGhlbiBkZWxldGUgaXRcclxuICAgIGNvbnN0IGZhaWxlZF9lbWJlZGRpbmdzX2ZpbGVfZXhpc3RzID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci5leGlzdHMoXCIuc21hcnQtY29ubmVjdGlvbnMvZmFpbGVkLWVtYmVkZGluZ3MudHh0XCIpO1xyXG4gICAgaWYoZmFpbGVkX2VtYmVkZGluZ3NfZmlsZV9leGlzdHMpIHtcclxuICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci5yZW1vdmUoXCIuc21hcnQtY29ubmVjdGlvbnMvZmFpbGVkLWVtYmVkZGluZ3MudHh0XCIpO1xyXG4gICAgfVxyXG4gICAgLy8gcnVuIGdldCBhbGwgZW1iZWRkaW5nc1xyXG4gICAgYXdhaXQgdGhpcy5nZXRfYWxsX2VtYmVkZGluZ3MoKTtcclxuICB9XHJcblxyXG5cclxuICAvLyBhZGQgLnNtYXJ0LWNvbm5lY3Rpb25zIHRvIC5naXRpZ25vcmUgdG8gcHJldmVudCBpc3N1ZXMgd2l0aCBsYXJnZSwgZnJlcXVlbnRseSB1cGRhdGVkIGVtYmVkZGluZ3MgZmlsZShzKVxyXG4gIGFzeW5jIGFkZF90b19naXRpZ25vcmUoKSB7XHJcbiAgICBpZighKGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIuZXhpc3RzKFwiLmdpdGlnbm9yZVwiKSkpIHtcclxuICAgICAgcmV0dXJuOyAvLyBpZiAuZ2l0aWdub3JlIGRvZXNuJ3QgZXhpc3QgdGhlbiBkb24ndCBhZGQgLnNtYXJ0LWNvbm5lY3Rpb25zIHRvIC5naXRpZ25vcmVcclxuICAgIH1cclxuICAgIGxldCBnaXRpZ25vcmVfZmlsZSA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIucmVhZChcIi5naXRpZ25vcmVcIik7XHJcbiAgICAvLyBpZiAuc21hcnQtY29ubmVjdGlvbnMgbm90IGluIC5naXRpZ25vcmVcclxuICAgIGlmIChnaXRpZ25vcmVfZmlsZS5pbmRleE9mKFwiLnNtYXJ0LWNvbm5lY3Rpb25zXCIpIDwgMCkge1xyXG4gICAgICAvLyBhZGQgLnNtYXJ0LWNvbm5lY3Rpb25zIHRvIC5naXRpZ25vcmVcclxuICAgICAgbGV0IGFkZF90b19naXRpZ25vcmUgPSBcIlxcblxcbiMgSWdub3JlIFNtYXJ0IENvbm5lY3Rpb25zIGZvbGRlciBiZWNhdXNlIGVtYmVkZGluZ3MgZmlsZSBpcyBsYXJnZSBhbmQgdXBkYXRlZCBmcmVxdWVudGx5XCI7XHJcbiAgICAgIGFkZF90b19naXRpZ25vcmUgKz0gXCJcXG4uc21hcnQtY29ubmVjdGlvbnNcIjtcclxuICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci53cml0ZShcIi5naXRpZ25vcmVcIiwgZ2l0aWdub3JlX2ZpbGUgKyBhZGRfdG9fZ2l0aWdub3JlKTtcclxuICAgICAgY29uc29sZS5sb2coXCJhZGRlZCAuc21hcnQtY29ubmVjdGlvbnMgdG8gLmdpdGlnbm9yZVwiKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8vIGZvcmNlIHJlZnJlc2ggZW1iZWRkaW5ncyBmaWxlIGJ1dCBmaXJzdCByZW5hbWUgZXhpc3RpbmcgZW1iZWRkaW5ncyBmaWxlIHRvIC5zbWFydC1jb25uZWN0aW9ucy9lbWJlZGRpbmdzLVlZWVktTU0tREQuanNvblxyXG4gIGFzeW5jIGZvcmNlX3JlZnJlc2hfZW1iZWRkaW5nc19maWxlKCkge1xyXG4gICAgbmV3IE9ic2lkaWFuLk5vdGljZShcIlNtYXJ0IENvbm5lY3Rpb25zOiBcdTk0RkVcdTYzQTVcdTY1ODdcdTRFRjZcdTVERjJcdTVGM0FcdTUyMzZcdTUyMzdcdTY1QjBcdUZGMENcdTZCNjNcdTU3MjhcdTUyMUJcdTVFRkFcdTY1QjBcdTc2ODRcdTk0RkVcdTYzQTUuLi5cIik7XHJcbiAgICAvLyBmb3JjZSByZWZyZXNoXHJcbiAgICBhd2FpdCB0aGlzLnNtYXJ0X3ZlY19saXRlLmZvcmNlX3JlZnJlc2goKTtcclxuICAgIC8vIHRyaWdnZXIgbWFraW5nIG5ldyBjb25uZWN0aW9uc1xyXG4gICAgYXdhaXQgdGhpcy5nZXRfYWxsX2VtYmVkZGluZ3MoKTtcclxuICAgIHRoaXMub3V0cHV0X3JlbmRlcl9sb2coKTtcclxuICAgIG5ldyBPYnNpZGlhbi5Ob3RpY2UoXCJTbWFydCBDb25uZWN0aW9uczogXHU5NEZFXHU2M0E1XHU2NTg3XHU0RUY2XHU1RjNBXHU1MjM2XHU1MjM3XHU2NUIwXHVGRjBDXHU2NUIwXHU3Njg0XHU5NEZFXHU2M0E1XHU1REYyXHU1RUZBXHU3QUNCXHUzMDAyXCIpO1xyXG4gIH1cclxuXHJcbiAgLy8gZ2V0IGVtYmVkZGluZ3MgZm9yIGVtYmVkX2lucHV0XHJcbiAgYXN5bmMgZ2V0X2ZpbGVfZW1iZWRkaW5ncyhjdXJyX2ZpbGUsIHNhdmU9dHJ1ZSkge1xyXG4gICAgLy8gbGV0IGJhdGNoX3Byb21pc2VzID0gW107XHJcbiAgICBsZXQgcmVxX2JhdGNoID0gW107XHJcbiAgICBsZXQgYmxvY2tzID0gW107XHJcbiAgICAvLyBpbml0aWF0ZSBjdXJyX2ZpbGVfa2V5IGZyb20gbWQ1KGN1cnJfZmlsZS5wYXRoKVxyXG4gICAgY29uc3QgY3Vycl9maWxlX2tleSA9IG1kNShjdXJyX2ZpbGUucGF0aCk7XHJcbiAgICAvLyBpbnRpYXRlIGZpbGVfZmlsZV9lbWJlZF9pbnB1dCBieSByZW1vdmluZyAubWQgYW5kIGNvbnZlcnRpbmcgZmlsZSBwYXRoIHRvIGJyZWFkY3J1bWJzIChcIiA+IFwiKVxyXG4gICAgbGV0IGZpbGVfZW1iZWRfaW5wdXQgPSBjdXJyX2ZpbGUucGF0aC5yZXBsYWNlKFwiLm1kXCIsIFwiXCIpO1xyXG4gICAgZmlsZV9lbWJlZF9pbnB1dCA9IGZpbGVfZW1iZWRfaW5wdXQucmVwbGFjZSgvXFwvL2csIFwiID4gXCIpO1xyXG4gICAgLy8gZW1iZWQgb24gZmlsZS5uYW1lL3RpdGxlIG9ubHkgaWYgcGF0aF9vbmx5IHBhdGggbWF0Y2hlciBzcGVjaWZpZWQgaW4gc2V0dGluZ3NcclxuICAgIGxldCBwYXRoX29ubHkgPSBmYWxzZTtcclxuICAgIGZvcihsZXQgaiA9IDA7IGogPCB0aGlzLnBhdGhfb25seS5sZW5ndGg7IGorKykge1xyXG4gICAgICBpZihjdXJyX2ZpbGUucGF0aC5pbmRleE9mKHRoaXMucGF0aF9vbmx5W2pdKSA+IC0xKSB7XHJcbiAgICAgICAgcGF0aF9vbmx5ID0gdHJ1ZTtcclxuICAgICAgICBjb25zb2xlLmxvZyhcInRpdGxlIG9ubHkgZmlsZSB3aXRoIG1hdGNoZXI6IFwiICsgdGhpcy5wYXRoX29ubHlbal0pO1xyXG4gICAgICAgIC8vIGJyZWFrIG91dCBvZiBsb29wXHJcbiAgICAgICAgYnJlYWs7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIC8vIHJldHVybiBlYXJseSBpZiBwYXRoX29ubHlcclxuICAgIGlmKHBhdGhfb25seSkge1xyXG4gICAgICByZXFfYmF0Y2gucHVzaChbY3Vycl9maWxlX2tleSwgZmlsZV9lbWJlZF9pbnB1dCwge1xyXG4gICAgICAgIG10aW1lOiBjdXJyX2ZpbGUuc3RhdC5tdGltZSxcclxuICAgICAgICBwYXRoOiBjdXJyX2ZpbGUucGF0aCxcclxuICAgICAgfV0pO1xyXG4gICAgICBhd2FpdCB0aGlzLmdldF9lbWJlZGRpbmdzX2JhdGNoKHJlcV9iYXRjaCk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIC8qKlxyXG4gICAgICogQkVHSU4gQ2FudmFzIGZpbGUgdHlwZSBFbWJlZGRpbmdcclxuICAgICAqL1xyXG4gICAgaWYoY3Vycl9maWxlLmV4dGVuc2lvbiA9PT0gXCJjYW52YXNcIikge1xyXG4gICAgICAvLyBnZXQgZmlsZSBjb250ZW50cyBhbmQgcGFyc2UgYXMgSlNPTlxyXG4gICAgICBjb25zdCBjYW52YXNfY29udGVudHMgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGN1cnJfZmlsZSk7XHJcbiAgICAgIGlmKCh0eXBlb2YgY2FudmFzX2NvbnRlbnRzID09PSBcInN0cmluZ1wiKSAmJiAoY2FudmFzX2NvbnRlbnRzLmluZGV4T2YoXCJub2Rlc1wiKSA+IC0xKSkge1xyXG4gICAgICAgIGNvbnN0IGNhbnZhc19qc29uID0gSlNPTi5wYXJzZShjYW52YXNfY29udGVudHMpO1xyXG4gICAgICAgIC8vIGZvciBlYWNoIG9iamVjdCBpbiBub2RlcyBhcnJheVxyXG4gICAgICAgIGZvcihsZXQgaiA9IDA7IGogPCBjYW52YXNfanNvbi5ub2Rlcy5sZW5ndGg7IGorKykge1xyXG4gICAgICAgICAgLy8gaWYgb2JqZWN0IGhhcyB0ZXh0IHByb3BlcnR5XHJcbiAgICAgICAgICBpZihjYW52YXNfanNvbi5ub2Rlc1tqXS50ZXh0KSB7XHJcbiAgICAgICAgICAgIC8vIGFkZCB0byBmaWxlX2VtYmVkX2lucHV0XHJcbiAgICAgICAgICAgIGZpbGVfZW1iZWRfaW5wdXQgKz0gXCJcXG5cIiArIGNhbnZhc19qc29uLm5vZGVzW2pdLnRleHQ7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICAvLyBpZiBvYmplY3QgaGFzIGZpbGUgcHJvcGVydHlcclxuICAgICAgICAgIGlmKGNhbnZhc19qc29uLm5vZGVzW2pdLmZpbGUpIHtcclxuICAgICAgICAgICAgLy8gYWRkIHRvIGZpbGVfZW1iZWRfaW5wdXRcclxuICAgICAgICAgICAgZmlsZV9lbWJlZF9pbnB1dCArPSBcIlxcbkxpbms6IFwiICsgY2FudmFzX2pzb24ubm9kZXNbal0uZmlsZTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgLy8gY29uc29sZS5sb2coZmlsZV9lbWJlZF9pbnB1dCk7XHJcbiAgICAgIHJlcV9iYXRjaC5wdXNoKFtjdXJyX2ZpbGVfa2V5LCBmaWxlX2VtYmVkX2lucHV0LCB7XHJcbiAgICAgICAgbXRpbWU6IGN1cnJfZmlsZS5zdGF0Lm10aW1lLFxyXG4gICAgICAgIHBhdGg6IGN1cnJfZmlsZS5wYXRoLFxyXG4gICAgICB9XSk7XHJcbiAgICAgIGF3YWl0IHRoaXMuZ2V0X2VtYmVkZGluZ3NfYmF0Y2gocmVxX2JhdGNoKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIEJFR0lOIEJsb2NrIFwic2VjdGlvblwiIGVtYmVkZGluZ1xyXG4gICAgICovXHJcbiAgICAvLyBnZXQgZmlsZSBjb250ZW50c1xyXG4gICAgY29uc3Qgbm90ZV9jb250ZW50cyA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQoY3Vycl9maWxlKTtcclxuICAgIGxldCBwcm9jZXNzZWRfc2luY2VfbGFzdF9zYXZlID0gMDtcclxuICAgIGNvbnN0IG5vdGVfc2VjdGlvbnMgPSB0aGlzLmJsb2NrX3BhcnNlcihub3RlX2NvbnRlbnRzLCBjdXJyX2ZpbGUucGF0aCk7XHJcbiAgICAvLyBjb25zb2xlLmxvZyhub3RlX3NlY3Rpb25zKTtcclxuICAgIC8vIGlmIG5vdGUgaGFzIG1vcmUgdGhhbiBvbmUgc2VjdGlvbiAoaWYgb25seSBvbmUgdGhlbiBpdHMgc2FtZSBhcyBmdWxsLWNvbnRlbnQpXHJcbiAgICBpZihub3RlX3NlY3Rpb25zLmxlbmd0aCA+IDEpIHtcclxuICAgICAgLy8gZm9yIGVhY2ggc2VjdGlvbiBpbiBmaWxlXHJcbiAgICAgIC8vY29uc29sZS5sb2coXCJTZWN0aW9uczogXCIgKyBub3RlX3NlY3Rpb25zLmxlbmd0aCk7XHJcbiAgICAgIGZvciAobGV0IGogPSAwOyBqIDwgbm90ZV9zZWN0aW9ucy5sZW5ndGg7IGorKykge1xyXG4gICAgICAgIC8vIGdldCBlbWJlZF9pbnB1dCBmb3IgYmxvY2tcclxuICAgICAgICBjb25zdCBibG9ja19lbWJlZF9pbnB1dCA9IG5vdGVfc2VjdGlvbnNbal0udGV4dDtcclxuICAgICAgICAvLyBjb25zb2xlLmxvZyhub3RlX3NlY3Rpb25zW2pdLnBhdGgpO1xyXG4gICAgICAgIC8vIGdldCBibG9jayBrZXkgZnJvbSBibG9jay5wYXRoIChjb250YWlucyBib3RoIGZpbGUucGF0aCBhbmQgaGVhZGVyIHBhdGgpXHJcbiAgICAgICAgY29uc3QgYmxvY2tfa2V5ID0gbWQ1KG5vdGVfc2VjdGlvbnNbal0ucGF0aCk7XHJcbiAgICAgICAgYmxvY2tzLnB1c2goYmxvY2tfa2V5KTtcclxuICAgICAgICAvLyBza2lwIGlmIGxlbmd0aCBvZiBibG9ja19lbWJlZF9pbnB1dCBzYW1lIGFzIGxlbmd0aCBvZiBlbWJlZGRpbmdzW2Jsb2NrX2tleV0ubWV0YS5zaXplXHJcbiAgICAgICAgLy8gVE9ETyBjb25zaWRlciByb3VuZGluZyB0byBuZWFyZXN0IDEwIG9yIDEwMCBmb3IgZnV6enkgbWF0Y2hpbmdcclxuICAgICAgICBpZiAodGhpcy5zbWFydF92ZWNfbGl0ZS5nZXRfc2l6ZShibG9ja19rZXkpID09PSBibG9ja19lbWJlZF9pbnB1dC5sZW5ndGgpIHtcclxuICAgICAgICAgIC8vIGxvZyBza2lwcGluZyBmaWxlXHJcbiAgICAgICAgICAvLyBjb25zb2xlLmxvZyhcInNraXBwaW5nIGJsb2NrIChsZW4pXCIpO1xyXG4gICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIC8vIGFkZCBoYXNoIHRvIGJsb2NrcyB0byBwcmV2ZW50IGVtcHR5IGJsb2NrcyB0cmlnZ2VyaW5nIGZ1bGwtZmlsZSBlbWJlZGRpbmdcclxuICAgICAgICAvLyBza2lwIGlmIGVtYmVkZGluZ3Mga2V5IGFscmVhZHkgZXhpc3RzIGFuZCBibG9jayBtdGltZSBpcyBncmVhdGVyIHRoYW4gb3IgZXF1YWwgdG8gZmlsZSBtdGltZVxyXG4gICAgICAgIGlmKHRoaXMuc21hcnRfdmVjX2xpdGUubXRpbWVfaXNfY3VycmVudChibG9ja19rZXksIGN1cnJfZmlsZS5zdGF0Lm10aW1lKSkge1xyXG4gICAgICAgICAgLy8gbG9nIHNraXBwaW5nIGZpbGVcclxuICAgICAgICAgIC8vIGNvbnNvbGUubG9nKFwic2tpcHBpbmcgYmxvY2sgKG10aW1lKVwiKTtcclxuICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgICAvLyBza2lwIGlmIGhhc2ggaXMgcHJlc2VudCBpbiBlbWJlZGRpbmdzIGFuZCBoYXNoIG9mIGJsb2NrX2VtYmVkX2lucHV0IGlzIGVxdWFsIHRvIGhhc2ggaW4gZW1iZWRkaW5nc1xyXG4gICAgICAgIGNvbnN0IGJsb2NrX2hhc2ggPSBtZDUoYmxvY2tfZW1iZWRfaW5wdXQudHJpbSgpKTtcclxuICAgICAgICBpZih0aGlzLnNtYXJ0X3ZlY19saXRlLmdldF9oYXNoKGJsb2NrX2tleSkgPT09IGJsb2NrX2hhc2gpIHtcclxuICAgICAgICAgIC8vIGxvZyBza2lwcGluZyBmaWxlXHJcbiAgICAgICAgICAvLyBjb25zb2xlLmxvZyhcInNraXBwaW5nIGJsb2NrIChoYXNoKVwiKTtcclxuICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gY3JlYXRlIHJlcV9iYXRjaCBmb3IgYmF0Y2hpbmcgcmVxdWVzdHNcclxuICAgICAgICByZXFfYmF0Y2gucHVzaChbYmxvY2tfa2V5LCBibG9ja19lbWJlZF9pbnB1dCwge1xyXG4gICAgICAgICAgLy8gb2xkbXRpbWU6IGN1cnJfZmlsZS5zdGF0Lm10aW1lLCBcclxuICAgICAgICAgIC8vIGdldCBjdXJyZW50IGRhdGV0aW1lIGFzIHVuaXggdGltZXN0YW1wXHJcbiAgICAgICAgICBtdGltZTogRGF0ZS5ub3coKSxcclxuICAgICAgICAgIGhhc2g6IGJsb2NrX2hhc2gsIFxyXG4gICAgICAgICAgcGFyZW50OiBjdXJyX2ZpbGVfa2V5LFxyXG4gICAgICAgICAgcGF0aDogbm90ZV9zZWN0aW9uc1tqXS5wYXRoLFxyXG4gICAgICAgICAgc2l6ZTogYmxvY2tfZW1iZWRfaW5wdXQubGVuZ3RoLFxyXG4gICAgICAgIH1dKTtcclxuICAgICAgICBpZihyZXFfYmF0Y2gubGVuZ3RoID4gOSkge1xyXG4gICAgICAgICAgLy8gYWRkIGJhdGNoIHRvIGJhdGNoX3Byb21pc2VzXHJcbiAgICAgICAgICBhd2FpdCB0aGlzLmdldF9lbWJlZGRpbmdzX2JhdGNoKHJlcV9iYXRjaCk7XHJcbiAgICAgICAgICBwcm9jZXNzZWRfc2luY2VfbGFzdF9zYXZlICs9IHJlcV9iYXRjaC5sZW5ndGg7XHJcbiAgICAgICAgICAvLyBsb2cgZW1iZWRkaW5nXHJcbiAgICAgICAgICAvLyBjb25zb2xlLmxvZyhcImVtYmVkZGluZzogXCIgKyBjdXJyX2ZpbGUucGF0aCk7XHJcbiAgICAgICAgICBpZiAocHJvY2Vzc2VkX3NpbmNlX2xhc3Rfc2F2ZSA+PSAzMCkge1xyXG4gICAgICAgICAgICAvLyB3cml0ZSBlbWJlZGRpbmdzIEpTT04gdG8gZmlsZVxyXG4gICAgICAgICAgICBhd2FpdCB0aGlzLnNhdmVfZW1iZWRkaW5nc190b19maWxlKCk7XHJcbiAgICAgICAgICAgIC8vIHJlc2V0IHByb2Nlc3NlZF9zaW5jZV9sYXN0X3NhdmVcclxuICAgICAgICAgICAgcHJvY2Vzc2VkX3NpbmNlX2xhc3Rfc2F2ZSA9IDA7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICAvLyByZXNldCByZXFfYmF0Y2hcclxuICAgICAgICAgIHJlcV9iYXRjaCA9IFtdO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgLy8gaWYgcmVxX2JhdGNoIGlzIG5vdCBlbXB0eVxyXG4gICAgaWYocmVxX2JhdGNoLmxlbmd0aCA+IDApIHtcclxuICAgICAgLy8gcHJvY2VzcyByZW1haW5pbmcgcmVxX2JhdGNoXHJcbiAgICAgIGF3YWl0IHRoaXMuZ2V0X2VtYmVkZGluZ3NfYmF0Y2gocmVxX2JhdGNoKTtcclxuICAgICAgcmVxX2JhdGNoID0gW107XHJcbiAgICAgIHByb2Nlc3NlZF9zaW5jZV9sYXN0X3NhdmUgKz0gcmVxX2JhdGNoLmxlbmd0aDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLyoqXHJcbiAgICAgKiBCRUdJTiBGaWxlIFwiZnVsbCBub3RlXCIgZW1iZWRkaW5nXHJcbiAgICAgKi9cclxuXHJcbiAgICAvLyBpZiBmaWxlIGxlbmd0aCBpcyBsZXNzIHRoYW4gfjgwMDAgdG9rZW5zIHVzZSBmdWxsIGZpbGUgY29udGVudHNcclxuICAgIC8vIGVsc2UgaWYgZmlsZSBsZW5ndGggaXMgZ3JlYXRlciB0aGFuIDgwMDAgdG9rZW5zIGJ1aWxkIGZpbGVfZW1iZWRfaW5wdXQgZnJvbSBmaWxlIGhlYWRpbmdzXHJcbiAgICBmaWxlX2VtYmVkX2lucHV0ICs9IGA6XFxuYDtcclxuICAgIC8qKlxyXG4gICAgICogVE9ETzogaW1wcm92ZS9yZWZhY3RvciB0aGUgZm9sbG93aW5nIFwibGFyZ2UgZmlsZSByZWR1Y2UgdG8gaGVhZGluZ3NcIiBsb2dpY1xyXG4gICAgICovXHJcbiAgICBpZihub3RlX2NvbnRlbnRzLmxlbmd0aCA8IE1BWF9FTUJFRF9TVFJJTkdfTEVOR1RIKSB7XHJcbiAgICAgIGZpbGVfZW1iZWRfaW5wdXQgKz0gbm90ZV9jb250ZW50c1xyXG4gICAgfWVsc2V7IFxyXG4gICAgICBjb25zdCBub3RlX21ldGFfY2FjaGUgPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShjdXJyX2ZpbGUpO1xyXG4gICAgICAvLyBmb3IgZWFjaCBoZWFkaW5nIGluIGZpbGVcclxuICAgICAgaWYodHlwZW9mIG5vdGVfbWV0YV9jYWNoZS5oZWFkaW5ncyA9PT0gXCJ1bmRlZmluZWRcIikge1xyXG4gICAgICAgIC8vIGNvbnNvbGUubG9nKFwibm8gaGVhZGluZ3MgZm91bmQsIHVzaW5nIGZpcnN0IGNodW5rIG9mIGZpbGUgaW5zdGVhZFwiKTtcclxuICAgICAgICBmaWxlX2VtYmVkX2lucHV0ICs9IG5vdGVfY29udGVudHMuc3Vic3RyaW5nKDAsIE1BWF9FTUJFRF9TVFJJTkdfTEVOR1RIKTtcclxuICAgICAgfWVsc2V7XHJcbiAgICAgICAgbGV0IG5vdGVfaGVhZGluZ3MgPSBcIlwiO1xyXG4gICAgICAgIGZvciAobGV0IGogPSAwOyBqIDwgbm90ZV9tZXRhX2NhY2hlLmhlYWRpbmdzLmxlbmd0aDsgaisrKSB7XHJcbiAgICAgICAgICAvLyBnZXQgaGVhZGluZyBsZXZlbFxyXG4gICAgICAgICAgY29uc3QgaGVhZGluZ19sZXZlbCA9IG5vdGVfbWV0YV9jYWNoZS5oZWFkaW5nc1tqXS5sZXZlbDtcclxuICAgICAgICAgIC8vIGdldCBoZWFkaW5nIHRleHRcclxuICAgICAgICAgIGNvbnN0IGhlYWRpbmdfdGV4dCA9IG5vdGVfbWV0YV9jYWNoZS5oZWFkaW5nc1tqXS5oZWFkaW5nO1xyXG4gICAgICAgICAgLy8gYnVpbGQgbWFya2Rvd24gaGVhZGluZ1xyXG4gICAgICAgICAgbGV0IG1kX2hlYWRpbmcgPSBcIlwiO1xyXG4gICAgICAgICAgZm9yIChsZXQgayA9IDA7IGsgPCBoZWFkaW5nX2xldmVsOyBrKyspIHtcclxuICAgICAgICAgICAgbWRfaGVhZGluZyArPSBcIiNcIjtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIC8vIGFkZCBoZWFkaW5nIHRvIG5vdGVfaGVhZGluZ3NcclxuICAgICAgICAgIG5vdGVfaGVhZGluZ3MgKz0gYCR7bWRfaGVhZGluZ30gJHtoZWFkaW5nX3RleHR9XFxuYDtcclxuICAgICAgICB9XHJcbiAgICAgICAgLy9jb25zb2xlLmxvZyhub3RlX2hlYWRpbmdzKTtcclxuICAgICAgICBmaWxlX2VtYmVkX2lucHV0ICs9IG5vdGVfaGVhZGluZ3NcclxuICAgICAgICBpZihmaWxlX2VtYmVkX2lucHV0Lmxlbmd0aCA+IE1BWF9FTUJFRF9TVFJJTkdfTEVOR1RIKSB7XHJcbiAgICAgICAgICBmaWxlX2VtYmVkX2lucHV0ID0gZmlsZV9lbWJlZF9pbnB1dC5zdWJzdHJpbmcoMCwgTUFYX0VNQkVEX1NUUklOR19MRU5HVEgpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgLy8gc2tpcCBlbWJlZGRpbmcgZnVsbCBmaWxlIGlmIGJsb2NrcyBpcyBub3QgZW1wdHkgYW5kIGFsbCBoYXNoZXMgYXJlIHByZXNlbnQgaW4gZW1iZWRkaW5nc1xyXG4gICAgLy8gYmV0dGVyIHRoYW4gaGFzaGluZyBmaWxlX2VtYmVkX2lucHV0IGJlY2F1c2UgbW9yZSByZXNpbGllbnQgdG8gaW5jb25zZXF1ZW50aWFsIGNoYW5nZXMgKHdoaXRlc3BhY2UgYmV0d2VlbiBoZWFkaW5ncylcclxuICAgIGNvbnN0IGZpbGVfaGFzaCA9IG1kNShmaWxlX2VtYmVkX2lucHV0LnRyaW0oKSk7XHJcbiAgICBjb25zdCBleGlzdGluZ19oYXNoID0gdGhpcy5zbWFydF92ZWNfbGl0ZS5nZXRfaGFzaChjdXJyX2ZpbGVfa2V5KTtcclxuICAgIGlmKGV4aXN0aW5nX2hhc2ggJiYgKGZpbGVfaGFzaCA9PT0gZXhpc3RpbmdfaGFzaCkpIHtcclxuICAgICAgLy8gY29uc29sZS5sb2coXCJza2lwcGluZyBmaWxlIChoYXNoKTogXCIgKyBjdXJyX2ZpbGUucGF0aCk7XHJcbiAgICAgIHRoaXMudXBkYXRlX3JlbmRlcl9sb2coYmxvY2tzLCBmaWxlX2VtYmVkX2lucHV0KTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfTtcclxuXHJcbiAgICAvLyBpZiBub3QgYWxyZWFkeSBza2lwcGluZyBhbmQgYmxvY2tzIGFyZSBwcmVzZW50XHJcbiAgICBjb25zdCBleGlzdGluZ19ibG9ja3MgPSB0aGlzLnNtYXJ0X3ZlY19saXRlLmdldF9jaGlsZHJlbihjdXJyX2ZpbGVfa2V5KTtcclxuICAgIGxldCBleGlzdGluZ19oYXNfYWxsX2Jsb2NrcyA9IHRydWU7XHJcbiAgICBpZihleGlzdGluZ19ibG9ja3MgJiYgQXJyYXkuaXNBcnJheShleGlzdGluZ19ibG9ja3MpICYmIChibG9ja3MubGVuZ3RoID4gMCkpIHtcclxuICAgICAgLy8gaWYgYWxsIGJsb2NrcyBhcmUgaW4gZXhpc3RpbmdfYmxvY2tzIHRoZW4gc2tpcCAoYWxsb3dzIGRlbGV0aW9uIG9mIHNtYWxsIGJsb2NrcyB3aXRob3V0IHRyaWdnZXJpbmcgZnVsbCBmaWxlIGVtYmVkZGluZylcclxuICAgICAgZm9yIChsZXQgaiA9IDA7IGogPCBibG9ja3MubGVuZ3RoOyBqKyspIHtcclxuICAgICAgICBpZihleGlzdGluZ19ibG9ja3MuaW5kZXhPZihibG9ja3Nbal0pID09PSAtMSkge1xyXG4gICAgICAgICAgZXhpc3RpbmdfaGFzX2FsbF9ibG9ja3MgPSBmYWxzZTtcclxuICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgLy8gaWYgZXhpc3RpbmcgaGFzIGFsbCBibG9ja3MgdGhlbiBjaGVjayBmaWxlIHNpemUgZm9yIGRlbHRhXHJcbiAgICBpZihleGlzdGluZ19oYXNfYWxsX2Jsb2Nrcyl7XHJcbiAgICAgIC8vIGdldCBjdXJyZW50IG5vdGUgZmlsZSBzaXplXHJcbiAgICAgIGNvbnN0IGN1cnJfZmlsZV9zaXplID0gY3Vycl9maWxlLnN0YXQuc2l6ZTtcclxuICAgICAgLy8gZ2V0IGZpbGUgc2l6ZSBmcm9tIGVtYmVkZGluZ3NcclxuICAgICAgY29uc3QgcHJldl9maWxlX3NpemUgPSB0aGlzLnNtYXJ0X3ZlY19saXRlLmdldF9zaXplKGN1cnJfZmlsZV9rZXkpO1xyXG4gICAgICBpZiAocHJldl9maWxlX3NpemUpIHtcclxuICAgICAgICAvLyBpZiBjdXJyIGZpbGUgc2l6ZSBpcyBsZXNzIHRoYW4gMTAlIGRpZmZlcmVudCBmcm9tIHByZXYgZmlsZSBzaXplXHJcbiAgICAgICAgY29uc3QgZmlsZV9kZWx0YV9wY3QgPSBNYXRoLnJvdW5kKChNYXRoLmFicyhjdXJyX2ZpbGVfc2l6ZSAtIHByZXZfZmlsZV9zaXplKSAvIGN1cnJfZmlsZV9zaXplKSAqIDEwMCk7XHJcbiAgICAgICAgaWYoZmlsZV9kZWx0YV9wY3QgPCAxMCkge1xyXG4gICAgICAgICAgLy8gc2tpcCBlbWJlZGRpbmdcclxuICAgICAgICAgIC8vIGNvbnNvbGUubG9nKFwic2tpcHBpbmcgZmlsZSAoc2l6ZSkgXCIgKyBjdXJyX2ZpbGUucGF0aCk7XHJcbiAgICAgICAgICB0aGlzLnJlbmRlcl9sb2cuc2tpcHBlZF9sb3dfZGVsdGFbY3Vycl9maWxlLm5hbWVdID0gZmlsZV9kZWx0YV9wY3QgKyBcIiVcIjtcclxuICAgICAgICAgIHRoaXMudXBkYXRlX3JlbmRlcl9sb2coYmxvY2tzLCBmaWxlX2VtYmVkX2lucHV0KTtcclxuICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIGxldCBtZXRhID0ge1xyXG4gICAgICBtdGltZTogY3Vycl9maWxlLnN0YXQubXRpbWUsXHJcbiAgICAgIGhhc2g6IGZpbGVfaGFzaCxcclxuICAgICAgcGF0aDogY3Vycl9maWxlLnBhdGgsXHJcbiAgICAgIHNpemU6IGN1cnJfZmlsZS5zdGF0LnNpemUsXHJcbiAgICAgIGNoaWxkcmVuOiBibG9ja3MsXHJcbiAgICB9O1xyXG4gICAgLy8gYmF0Y2hfcHJvbWlzZXMucHVzaCh0aGlzLmdldF9lbWJlZGRpbmdzKGN1cnJfZmlsZV9rZXksIGZpbGVfZW1iZWRfaW5wdXQsIG1ldGEpKTtcclxuICAgIHJlcV9iYXRjaC5wdXNoKFtjdXJyX2ZpbGVfa2V5LCBmaWxlX2VtYmVkX2lucHV0LCBtZXRhXSk7XHJcbiAgICAvLyBzZW5kIGJhdGNoIHJlcXVlc3RcclxuICAgIGF3YWl0IHRoaXMuZ2V0X2VtYmVkZGluZ3NfYmF0Y2gocmVxX2JhdGNoKTtcclxuXHJcbiAgICAvLyBsb2cgZW1iZWRkaW5nXHJcbiAgICAvLyBjb25zb2xlLmxvZyhcImVtYmVkZGluZzogXCIgKyBjdXJyX2ZpbGUucGF0aCk7XHJcbiAgICBpZiAoc2F2ZSkge1xyXG4gICAgICAvLyB3cml0ZSBlbWJlZGRpbmdzIEpTT04gdG8gZmlsZVxyXG4gICAgICBhd2FpdCB0aGlzLnNhdmVfZW1iZWRkaW5nc190b19maWxlKCk7XHJcbiAgICB9XHJcblxyXG4gIH1cclxuXHJcbiAgdXBkYXRlX3JlbmRlcl9sb2coYmxvY2tzLCBmaWxlX2VtYmVkX2lucHV0KSB7XHJcbiAgICBpZiAoYmxvY2tzLmxlbmd0aCA+IDApIHtcclxuICAgICAgLy8gbXVsdGlwbHkgYnkgMiBiZWNhdXNlIGltcGxpZXMgd2Ugc2F2ZWQgdG9rZW4gc3BlbmRpbmcgb24gYmxvY2tzKHNlY3Rpb25zKSwgdG9vXHJcbiAgICAgIHRoaXMucmVuZGVyX2xvZy50b2tlbnNfc2F2ZWRfYnlfY2FjaGUgKz0gZmlsZV9lbWJlZF9pbnB1dC5sZW5ndGggLyAyO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgLy8gY2FsYyB0b2tlbnMgc2F2ZWQgYnkgY2FjaGU6IGRpdmlkZSBieSA0IGZvciB0b2tlbiBlc3RpbWF0ZVxyXG4gICAgICB0aGlzLnJlbmRlcl9sb2cudG9rZW5zX3NhdmVkX2J5X2NhY2hlICs9IGZpbGVfZW1iZWRfaW5wdXQubGVuZ3RoIC8gNDtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIGdldF9lbWJlZGRpbmdzX2JhdGNoKHJlcV9iYXRjaCkge1xyXG4gICAgY29uc29sZS5sb2coXCJnZXRfZW1iZWRkaW5nc19iYXRjaFwiKTtcclxuICAgIC8vIGlmIHJlcV9iYXRjaCBpcyBlbXB0eSB0aGVuIHJldHVyblxyXG4gICAgaWYocmVxX2JhdGNoLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xyXG4gICAgLy8gY3JlYXRlIGFycmFyeSBvZiBlbWJlZF9pbnB1dHMgZnJvbSByZXFfYmF0Y2hbaV1bMV1cclxuICAgIGNvbnN0IGVtYmVkX2lucHV0cyA9IHJlcV9iYXRjaC5tYXAoKHJlcSkgPT4gcmVxWzFdKTtcclxuICAgIC8vIHJlcXVlc3QgZW1iZWRkaW5ncyBmcm9tIGVtYmVkX2lucHV0c1xyXG4gICAgY29uc3QgcmVxdWVzdFJlc3VsdHMgPSBhd2FpdCB0aGlzLnJlcXVlc3RfZW1iZWRkaW5nX2Zyb21faW5wdXQoZW1iZWRfaW5wdXRzKTtcclxuICAgIC8vIGlmIHJlcXVlc3RSZXN1bHRzIGlzIG51bGwgdGhlbiByZXR1cm5cclxuICAgIGlmKCFyZXF1ZXN0UmVzdWx0cykge1xyXG4gICAgICBjb25zb2xlLmxvZyhcImZhaWxlZCBlbWJlZGRpbmcgYmF0Y2hcIik7XHJcbiAgICAgIC8vIGxvZyBmYWlsZWQgZmlsZSBuYW1lcyB0byByZW5kZXJfbG9nXHJcbiAgICAgIHRoaXMucmVuZGVyX2xvZy5mYWlsZWRfZW1iZWRkaW5ncyA9IFsuLi50aGlzLnJlbmRlcl9sb2cuZmFpbGVkX2VtYmVkZGluZ3MsIC4uLnJlcV9iYXRjaC5tYXAoKHJlcSkgPT4gcmVxWzJdLnBhdGgpXTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgLy8gaWYgcmVxdWVzdFJlc3VsdHMgaXMgbm90IG51bGxcclxuICAgIGlmKHJlcXVlc3RSZXN1bHRzKXtcclxuICAgICAgdGhpcy5oYXNfbmV3X2VtYmVkZGluZ3MgPSB0cnVlO1xyXG4gICAgICAvLyBhZGQgZW1iZWRkaW5nIGtleSB0byByZW5kZXJfbG9nXHJcbiAgICAgIGlmKHRoaXMuc2V0dGluZ3MubG9nX3JlbmRlcil7XHJcbiAgICAgICAgaWYodGhpcy5zZXR0aW5ncy5sb2dfcmVuZGVyX2ZpbGVzKXtcclxuICAgICAgICAgIHRoaXMucmVuZGVyX2xvZy5maWxlcyA9IFsuLi50aGlzLnJlbmRlcl9sb2cuZmlsZXMsIC4uLnJlcV9iYXRjaC5tYXAoKHJlcSkgPT4gcmVxWzJdLnBhdGgpXTtcclxuICAgICAgICB9XHJcbiAgICAgICAgdGhpcy5yZW5kZXJfbG9nLm5ld19lbWJlZGRpbmdzICs9IHJlcV9iYXRjaC5sZW5ndGg7XHJcbiAgICAgICAgLy8gYWRkIHRva2VuIHVzYWdlIHRvIHJlbmRlcl9sb2dcclxuICAgICAgICB0aGlzLnJlbmRlcl9sb2cudG9rZW5fdXNhZ2UgKz0gcmVxdWVzdFJlc3VsdHMudXNhZ2UudG90YWxfdG9rZW5zO1xyXG4gICAgICB9XHJcbiAgICAgIC8vIGNvbnNvbGUubG9nKHJlcXVlc3RSZXN1bHRzLmRhdGEubGVuZ3RoKTtcclxuICAgICAgLy8gbG9vcCB0aHJvdWdoIHJlcXVlc3RSZXN1bHRzLmRhdGFcclxuICAgICAgZm9yKGxldCBpID0gMDsgaSA8IHJlcXVlc3RSZXN1bHRzLmRhdGEubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICBjb25zdCB2ZWMgPSByZXF1ZXN0UmVzdWx0cy5kYXRhW2ldLmVtYmVkZGluZztcclxuICAgICAgICBjb25zdCBpbmRleCA9IHJlcXVlc3RSZXN1bHRzLmRhdGFbaV0uaW5kZXg7XHJcbiAgICAgICAgaWYodmVjKSB7XHJcbiAgICAgICAgICBjb25zdCBrZXkgPSByZXFfYmF0Y2hbaW5kZXhdWzBdO1xyXG4gICAgICAgICAgY29uc3QgbWV0YSA9IHJlcV9iYXRjaFtpbmRleF1bMl07XHJcbiAgICAgICAgICB0aGlzLnNtYXJ0X3ZlY19saXRlLnNhdmVfZW1iZWRkaW5nKGtleSwgdmVjLCBtZXRhKTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIHJlcXVlc3RfZW1iZWRkaW5nX2Zyb21faW5wdXQoZW1iZWRfaW5wdXQsIHJldHJpZXMgPSAwKSB7XHJcbiAgICAvLyAoRk9SIFRFU1RJTkcpIHRlc3QgZmFpbCBwcm9jZXNzIGJ5IGZvcmNpbmcgZmFpbFxyXG4gICAgLy8gcmV0dXJuIG51bGw7XHJcbiAgICAvLyBjaGVjayBpZiBlbWJlZF9pbnB1dCBpcyBhIHN0cmluZ1xyXG4gICAgLy8gaWYodHlwZW9mIGVtYmVkX2lucHV0ICE9PSBcInN0cmluZ1wiKSB7XHJcbiAgICAvLyAgIGNvbnNvbGUubG9nKFwiZW1iZWRfaW5wdXQgaXMgbm90IGEgc3RyaW5nXCIpO1xyXG4gICAgLy8gICByZXR1cm4gbnVsbDtcclxuICAgIC8vIH1cclxuICAgIC8vIGNoZWNrIGlmIGVtYmVkX2lucHV0IGlzIGVtcHR5XHJcbiAgICBpZihlbWJlZF9pbnB1dC5sZW5ndGggPT09IDApIHtcclxuICAgICAgY29uc29sZS5sb2coXCJlbWJlZF9pbnB1dCBpcyBlbXB0eVwiKTtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICBjb25zdCB1c2VkUGFyYW1zID0ge1xyXG4gICAgICBtb2RlbDogXCJ0ZXh0LWVtYmVkZGluZy1hZGEtMDAyXCIsXHJcbiAgICAgIGlucHV0OiBlbWJlZF9pbnB1dCxcclxuICAgIH07XHJcbiAgICAvLyBjb25zb2xlLmxvZyh0aGlzLnNldHRpbmdzLmFwaV9rZXkpO1xyXG4gICAgY29uc3QgcmVxUGFyYW1zID0ge1xyXG4gICAgICB1cmw6IGAke3RoaXMuc2V0dGluZ3MuYXBpX2VuZHBvaW50fS92MS9lbWJlZGRpbmdzYCxcclxuICAgICAgbWV0aG9kOiBcIlBPU1RcIixcclxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkodXNlZFBhcmFtcyksXHJcbiAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIixcclxuICAgICAgICBcIkF1dGhvcml6YXRpb25cIjogYEJlYXJlciAke3RoaXMuc2V0dGluZ3MuYXBpX2tleX1gXHJcbiAgICAgIH1cclxuICAgIH07XHJcbiAgICBsZXQgcmVzcDtcclxuICAgIHRyeSB7XHJcbiAgICAgIHJlc3AgPSBhd2FpdCAoMCwgT2JzaWRpYW4ucmVxdWVzdCkocmVxUGFyYW1zKVxyXG4gICAgICByZXR1cm4gSlNPTi5wYXJzZShyZXNwKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIC8vIHJldHJ5IHJlcXVlc3QgaWYgZXJyb3IgaXMgNDI5XHJcbiAgICAgIGlmKChlcnJvci5zdGF0dXMgPT09IDQyOSkgJiYgKHJldHJpZXMgPCAzKSkge1xyXG4gICAgICAgIHJldHJpZXMrKztcclxuICAgICAgICAvLyBleHBvbmVudGlhbCBiYWNrb2ZmXHJcbiAgICAgICAgY29uc3QgYmFja29mZiA9IE1hdGgucG93KHJldHJpZXMsIDIpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGByZXRyeWluZyByZXF1ZXN0ICg0MjkpIGluICR7YmFja29mZn0gc2Vjb25kcy4uLmApO1xyXG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHIgPT4gc2V0VGltZW91dChyLCAxMDAwICogYmFja29mZikpO1xyXG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLnJlcXVlc3RfZW1iZWRkaW5nX2Zyb21faW5wdXQoZW1iZWRfaW5wdXQsIHJldHJpZXMpO1xyXG4gICAgICB9XHJcbiAgICAgIC8vIGxvZyBmdWxsIGVycm9yIHRvIGNvbnNvbGVcclxuICAgICAgY29uc29sZS5sb2cocmVzcCk7XHJcbiAgICAgIC8vIGNvbnNvbGUubG9nKFwiZmlyc3QgbGluZSBvZiBlbWJlZDogXCIgKyBlbWJlZF9pbnB1dC5zdWJzdHJpbmcoMCwgZW1iZWRfaW5wdXQuaW5kZXhPZihcIlxcblwiKSkpO1xyXG4gICAgICAvLyBjb25zb2xlLmxvZyhcImVtYmVkIGlucHV0IGxlbmd0aDogXCIrIGVtYmVkX2lucHV0Lmxlbmd0aCk7XHJcbiAgICAgIC8vIGlmKEFycmF5LmlzQXJyYXkoZW1iZWRfaW5wdXQpKSB7XHJcbiAgICAgIC8vICAgY29uc29sZS5sb2coZW1iZWRfaW5wdXQubWFwKChpbnB1dCkgPT4gaW5wdXQubGVuZ3RoKSk7XHJcbiAgICAgIC8vIH1cclxuICAgICAgLy8gY29uc29sZS5sb2coXCJlcnJvbmVvdXMgZW1iZWQgaW5wdXQ6IFwiICsgZW1iZWRfaW5wdXQpO1xyXG4gICAgICBjb25zb2xlLmxvZyhlcnJvcik7XHJcbiAgICAgIC8vIGNvbnNvbGUubG9nKHVzZWRQYXJhbXMpO1xyXG4gICAgICAvLyBjb25zb2xlLmxvZyh1c2VkUGFyYW1zLmlucHV0Lmxlbmd0aCk7XHJcbiAgICAgIHJldHVybiBudWxsOyBcclxuICAgIH1cclxuICB9XHJcbiAgYXN5bmMgdGVzdF9hcGlfa2V5KCkge1xyXG4gICAgY29uc3QgZW1iZWRfaW5wdXQgPSBcIlRoaXMgaXMgYSB0ZXN0IG9mIHRoZSBPcGVuQUkgQVBJLlwiO1xyXG4gICAgY29uc3QgcmVzcCA9IGF3YWl0IHRoaXMucmVxdWVzdF9lbWJlZGRpbmdfZnJvbV9pbnB1dChlbWJlZF9pbnB1dCk7XHJcbiAgICBpZihyZXNwICYmIHJlc3AudXNhZ2UpIHtcclxuICAgICAgY29uc29sZS5sb2coXCJBUEkga2V5IGlzIHZhbGlkXCIpO1xyXG4gICAgICByZXR1cm4gdHJ1ZTtcclxuICAgIH1lbHNle1xyXG4gICAgICBjb25zb2xlLmxvZyhcIkFQSSBrZXkgaXMgaW52YWxpZFwiKTtcclxuICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcblxyXG4gIG91dHB1dF9yZW5kZXJfbG9nKCkge1xyXG4gICAgLy8gaWYgc2V0dGluZ3MubG9nX3JlbmRlciBpcyB0cnVlXHJcbiAgICBpZih0aGlzLnNldHRpbmdzLmxvZ19yZW5kZXIpIHtcclxuICAgICAgaWYgKHRoaXMucmVuZGVyX2xvZy5uZXdfZW1iZWRkaW5ncyA9PT0gMCkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfWVsc2V7XHJcbiAgICAgICAgLy8gcHJldHR5IHByaW50IHRoaXMucmVuZGVyX2xvZyB0byBjb25zb2xlXHJcbiAgICAgICAgY29uc29sZS5sb2coSlNPTi5zdHJpbmdpZnkodGhpcy5yZW5kZXJfbG9nLCBudWxsLCAyKSk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvLyBjbGVhciByZW5kZXJfbG9nXHJcbiAgICB0aGlzLnJlbmRlcl9sb2cgPSB7fTtcclxuICAgIHRoaXMucmVuZGVyX2xvZy5kZWxldGVkX2VtYmVkZGluZ3MgPSAwO1xyXG4gICAgdGhpcy5yZW5kZXJfbG9nLmV4Y2x1c2lvbnNfbG9ncyA9IHt9O1xyXG4gICAgdGhpcy5yZW5kZXJfbG9nLmZhaWxlZF9lbWJlZGRpbmdzID0gW107XHJcbiAgICB0aGlzLnJlbmRlcl9sb2cuZmlsZXMgPSBbXTtcclxuICAgIHRoaXMucmVuZGVyX2xvZy5uZXdfZW1iZWRkaW5ncyA9IDA7XHJcbiAgICB0aGlzLnJlbmRlcl9sb2cuc2tpcHBlZF9sb3dfZGVsdGEgPSB7fTtcclxuICAgIHRoaXMucmVuZGVyX2xvZy50b2tlbl91c2FnZSA9IDA7XHJcbiAgICB0aGlzLnJlbmRlcl9sb2cudG9rZW5zX3NhdmVkX2J5X2NhY2hlID0gMDtcclxuICB9XHJcblxyXG4gIC8vIGZpbmQgY29ubmVjdGlvbnMgYnkgbW9zdCBzaW1pbGFyIHRvIGN1cnJlbnQgbm90ZSBieSBjb3NpbmUgc2ltaWxhcml0eVxyXG4gIGFzeW5jIGZpbmRfbm90ZV9jb25uZWN0aW9ucyhjdXJyZW50X25vdGU9bnVsbCkge1xyXG4gICAgLy8gbWQ1IG9mIGN1cnJlbnQgbm90ZSBwYXRoXHJcbiAgICBjb25zdCBjdXJyX2tleSA9IG1kNShjdXJyZW50X25vdGUucGF0aCk7XHJcbiAgICAvLyBpZiBpbiB0aGlzLm5lYXJlc3RfY2FjaGUgdGhlbiBzZXQgdG8gbmVhcmVzdFxyXG4gICAgLy8gZWxzZSBnZXQgbmVhcmVzdFxyXG4gICAgbGV0IG5lYXJlc3QgPSBbXTtcclxuICAgIGlmKHRoaXMubmVhcmVzdF9jYWNoZVtjdXJyX2tleV0pIHtcclxuICAgICAgbmVhcmVzdCA9IHRoaXMubmVhcmVzdF9jYWNoZVtjdXJyX2tleV07XHJcbiAgICAgIC8vIGNvbnNvbGUubG9nKFwibmVhcmVzdCBmcm9tIGNhY2hlXCIpO1xyXG4gICAgfWVsc2V7XHJcbiAgICAgIC8vIHNraXAgZmlsZXMgd2hlcmUgcGF0aCBjb250YWlucyBhbnkgZXhjbHVzaW9uc1xyXG4gICAgICBmb3IobGV0IGogPSAwOyBqIDwgdGhpcy5maWxlX2V4Y2x1c2lvbnMubGVuZ3RoOyBqKyspIHtcclxuICAgICAgICBpZihjdXJyZW50X25vdGUucGF0aC5pbmRleE9mKHRoaXMuZmlsZV9leGNsdXNpb25zW2pdKSA+IC0xKSB7XHJcbiAgICAgICAgICB0aGlzLmxvZ19leGNsdXNpb24odGhpcy5maWxlX2V4Y2x1c2lvbnNbal0pO1xyXG4gICAgICAgICAgLy8gYnJlYWsgb3V0IG9mIGxvb3AgYW5kIGZpbmlzaCBoZXJlXHJcbiAgICAgICAgICByZXR1cm4gXCJcdTVGNTNcdTUyNERcdTdCMTRcdThCQjBcdTVERjJcdTg4QUJcdTYzOTJcdTk2NjRcIjtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgLy8gZ2V0IGFsbCBlbWJlZGRpbmdzXHJcbiAgICAgIC8vIGF3YWl0IHRoaXMuZ2V0X2FsbF9lbWJlZGRpbmdzKCk7XHJcbiAgICAgIC8vIHdyYXAgZ2V0IGFsbCBpbiBzZXRUaW1lb3V0IHRvIGFsbG93IGZvciBVSSB0byB1cGRhdGVcclxuICAgICAgc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgICAgdGhpcy5nZXRfYWxsX2VtYmVkZGluZ3MoKVxyXG4gICAgICB9LCAzMDAwKTtcclxuICAgICAgLy8gZ2V0IGZyb20gY2FjaGUgaWYgbXRpbWUgaXMgc2FtZSBhbmQgdmFsdWVzIGFyZSBub3QgZW1wdHlcclxuICAgICAgaWYodGhpcy5zbWFydF92ZWNfbGl0ZS5tdGltZV9pc19jdXJyZW50KGN1cnJfa2V5LCBjdXJyZW50X25vdGUuc3RhdC5tdGltZSkpIHtcclxuICAgICAgICAvLyBza2lwcGluZyBnZXQgZmlsZSBlbWJlZGRpbmdzIGJlY2F1c2Ugbm90aGluZyBoYXMgY2hhbmdlZFxyXG4gICAgICAgIC8vIGNvbnNvbGUubG9nKFwiZmluZF9ub3RlX2Nvbm5lY3Rpb25zIC0gc2tpcHBpbmcgZmlsZSAobXRpbWUpXCIpO1xyXG4gICAgICB9ZWxzZXtcclxuICAgICAgICAvLyBnZXQgZmlsZSBlbWJlZGRpbmdzXHJcbiAgICAgICAgYXdhaXQgdGhpcy5nZXRfZmlsZV9lbWJlZGRpbmdzKGN1cnJlbnRfbm90ZSk7XHJcbiAgICAgIH1cclxuICAgICAgLy8gZ2V0IGN1cnJlbnQgbm90ZSBlbWJlZGRpbmcgdmVjdG9yXHJcbiAgICAgIGNvbnN0IHZlYyA9IHRoaXMuc21hcnRfdmVjX2xpdGUuZ2V0X3ZlYyhjdXJyX2tleSk7XHJcbiAgICAgIGlmKCF2ZWMpIHtcclxuICAgICAgICByZXR1cm4gXCJcdTgzQjdcdTUzRDZcdTVENENcdTUxNjVcdTUxODVcdTVCQjlcdTY1RjZcdTUxRkFcdTk1MTlcdUZGMUEgXCIrY3VycmVudF9ub3RlLnBhdGg7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIGNvbXB1dGUgY29zaW5lIHNpbWlsYXJpdHkgYmV0d2VlbiBjdXJyZW50IG5vdGUgYW5kIGFsbCBvdGhlciBub3RlcyB2aWEgZW1iZWRkaW5nc1xyXG4gICAgICBuZWFyZXN0ID0gdGhpcy5zbWFydF92ZWNfbGl0ZS5uZWFyZXN0KHZlYywge1xyXG4gICAgICAgIHNraXBfa2V5OiBjdXJyX2tleSxcclxuICAgICAgICBza2lwX3NlY3Rpb25zOiB0aGlzLnNldHRpbmdzLnNraXBfc2VjdGlvbnMsXHJcbiAgICAgIH0pO1xyXG4gIFxyXG4gICAgICAvLyBzYXZlIHRvIHRoaXMubmVhcmVzdF9jYWNoZVxyXG4gICAgICB0aGlzLm5lYXJlc3RfY2FjaGVbY3Vycl9rZXldID0gbmVhcmVzdDtcclxuICAgIH1cclxuXHJcbiAgICAvLyByZXR1cm4gYXJyYXkgc29ydGVkIGJ5IGNvc2luZSBzaW1pbGFyaXR5XHJcbiAgICByZXR1cm4gbmVhcmVzdDtcclxuICB9XHJcbiAgXHJcbiAgLy8gY3JlYXRlIHJlbmRlcl9sb2cgb2JqZWN0IG9mIGV4bHVzaW9ucyB3aXRoIG51bWJlciBvZiB0aW1lcyBza2lwcGVkIGFzIHZhbHVlXHJcbiAgbG9nX2V4Y2x1c2lvbihleGNsdXNpb24pIHtcclxuICAgIC8vIGluY3JlbWVudCByZW5kZXJfbG9nIGZvciBza2lwcGVkIGZpbGVcclxuICAgIHRoaXMucmVuZGVyX2xvZy5leGNsdXNpb25zX2xvZ3NbZXhjbHVzaW9uXSA9ICh0aGlzLnJlbmRlcl9sb2cuZXhjbHVzaW9uc19sb2dzW2V4Y2x1c2lvbl0gfHwgMCkgKyAxO1xyXG4gIH1cclxuICBcclxuXHJcbiAgYmxvY2tfcGFyc2VyKG1hcmtkb3duLCBmaWxlX3BhdGgpe1xyXG4gICAgLy8gaWYgdGhpcy5zZXR0aW5ncy5za2lwX3NlY3Rpb25zIGlzIHRydWUgdGhlbiByZXR1cm4gZW1wdHkgYXJyYXlcclxuICAgIGlmKHRoaXMuc2V0dGluZ3Muc2tpcF9zZWN0aW9ucykge1xyXG4gICAgICByZXR1cm4gW107XHJcbiAgICB9XHJcbiAgICAvLyBzcGxpdCB0aGUgbWFya2Rvd24gaW50byBsaW5lc1xyXG4gICAgY29uc3QgbGluZXMgPSBtYXJrZG93bi5zcGxpdCgnXFxuJyk7XHJcbiAgICAvLyBpbml0aWFsaXplIHRoZSBibG9ja3MgYXJyYXlcclxuICAgIGxldCBibG9ja3MgPSBbXTtcclxuICAgIC8vIGN1cnJlbnQgaGVhZGVycyBhcnJheVxyXG4gICAgbGV0IGN1cnJlbnRIZWFkZXJzID0gW107XHJcbiAgICAvLyByZW1vdmUgLm1kIGZpbGUgZXh0ZW5zaW9uIGFuZCBjb252ZXJ0IGZpbGVfcGF0aCB0byBicmVhZGNydW1iIGZvcm1hdHRpbmdcclxuICAgIGNvbnN0IGZpbGVfYnJlYWRjcnVtYnMgPSBmaWxlX3BhdGgucmVwbGFjZSgnLm1kJywgJycpLnJlcGxhY2UoL1xcLy9nLCAnID4gJyk7XHJcbiAgICAvLyBpbml0aWFsaXplIHRoZSBibG9jayBzdHJpbmdcclxuICAgIGxldCBibG9jayA9ICcnO1xyXG4gICAgbGV0IGJsb2NrX2hlYWRpbmdzID0gJyc7XHJcbiAgICBsZXQgYmxvY2tfcGF0aCA9IGZpbGVfcGF0aDtcclxuXHJcbiAgICBsZXQgbGFzdF9oZWFkaW5nX2xpbmUgPSAwO1xyXG4gICAgbGV0IGkgPSAwO1xyXG4gICAgbGV0IGJsb2NrX2hlYWRpbmdzX2xpc3QgPSBbXTtcclxuICAgIC8vIGxvb3AgdGhyb3VnaCB0aGUgbGluZXNcclxuICAgIGZvciAoaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7IGkrKykge1xyXG4gICAgICAvLyBnZXQgdGhlIGxpbmVcclxuICAgICAgY29uc3QgbGluZSA9IGxpbmVzW2ldO1xyXG4gICAgICAvLyBpZiBsaW5lIGRvZXMgbm90IHN0YXJ0IHdpdGggI1xyXG4gICAgICAvLyBvciBpZiBsaW5lIHN0YXJ0cyB3aXRoICMgYW5kIHNlY29uZCBjaGFyYWN0ZXIgaXMgYSB3b3JkIG9yIG51bWJlciBpbmRpY2F0aW5nIGEgXCJ0YWdcIlxyXG4gICAgICAvLyB0aGVuIGFkZCB0byBibG9ja1xyXG4gICAgICBpZiAoIWxpbmUuc3RhcnRzV2l0aCgnIycpIHx8IChbJyMnLCcgJ10uaW5kZXhPZihsaW5lWzFdKSA8IDApKXtcclxuICAgICAgICAvLyBza2lwIGlmIGxpbmUgaXMgZW1wdHlcclxuICAgICAgICBpZihsaW5lID09PSAnJykgY29udGludWU7XHJcbiAgICAgICAgLy8gc2tpcCBpZiBsaW5lIGlzIGVtcHR5IGJ1bGxldCBvciBjaGVja2JveFxyXG4gICAgICAgIGlmKFsnLSAnLCAnLSBbIF0gJ10uaW5kZXhPZihsaW5lKSA+IC0xKSBjb250aW51ZTtcclxuICAgICAgICAvLyBpZiBjdXJyZW50SGVhZGVycyBpcyBlbXB0eSBza2lwIChvbmx5IGJsb2NrcyB3aXRoIGhlYWRlcnMsIG90aGVyd2lzZSBibG9jay5wYXRoIGNvbmZsaWN0cyB3aXRoIGZpbGUucGF0aClcclxuICAgICAgICBpZihjdXJyZW50SGVhZGVycy5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xyXG4gICAgICAgIC8vIGFkZCBsaW5lIHRvIGJsb2NrXHJcbiAgICAgICAgYmxvY2sgKz0gXCJcXG5cIiArIGxpbmU7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuICAgICAgLyoqXHJcbiAgICAgICAqIEJFR0lOIEhlYWRpbmcgcGFyc2luZ1xyXG4gICAgICAgKiAtIGxpa2VseSBhIGhlYWRpbmcgaWYgbWFkZSBpdCB0aGlzIGZhclxyXG4gICAgICAgKi9cclxuICAgICAgbGFzdF9oZWFkaW5nX2xpbmUgPSBpO1xyXG4gICAgICAvLyBwdXNoIHRoZSBjdXJyZW50IGJsb2NrIHRvIHRoZSBibG9ja3MgYXJyYXkgdW5sZXNzIGxhc3QgbGluZSB3YXMgYSBhbHNvIGEgaGVhZGVyXHJcbiAgICAgIGlmKGkgPiAwICYmIChsYXN0X2hlYWRpbmdfbGluZSAhPT0gKGktMSkpICYmIChibG9jay5pbmRleE9mKFwiXFxuXCIpID4gLTEpICYmIHRoaXMudmFsaWRhdGVfaGVhZGluZ3MoYmxvY2tfaGVhZGluZ3MpKSB7XHJcbiAgICAgICAgb3V0cHV0X2Jsb2NrKCk7XHJcbiAgICAgIH1cclxuICAgICAgLy8gZ2V0IHRoZSBoZWFkZXIgbGV2ZWxcclxuICAgICAgY29uc3QgbGV2ZWwgPSBsaW5lLnNwbGl0KCcjJykubGVuZ3RoIC0gMTtcclxuICAgICAgLy8gcmVtb3ZlIGFueSBoZWFkZXJzIGZyb20gdGhlIGN1cnJlbnQgaGVhZGVycyBhcnJheSB0aGF0IGFyZSBoaWdoZXIgdGhhbiB0aGUgY3VycmVudCBoZWFkZXIgbGV2ZWxcclxuICAgICAgY3VycmVudEhlYWRlcnMgPSBjdXJyZW50SGVhZGVycy5maWx0ZXIoaGVhZGVyID0+IGhlYWRlci5sZXZlbCA8IGxldmVsKTtcclxuICAgICAgLy8gYWRkIGhlYWRlciBhbmQgbGV2ZWwgdG8gY3VycmVudCBoZWFkZXJzIGFycmF5XHJcbiAgICAgIC8vIHRyaW0gdGhlIGhlYWRlciB0byByZW1vdmUgXCIjXCIgYW5kIGFueSB0cmFpbGluZyBzcGFjZXNcclxuICAgICAgY3VycmVudEhlYWRlcnMucHVzaCh7aGVhZGVyOiBsaW5lLnJlcGxhY2UoLyMvZywgJycpLnRyaW0oKSwgbGV2ZWw6IGxldmVsfSk7XHJcbiAgICAgIC8vIGluaXRpYWxpemUgdGhlIGJsb2NrIGJyZWFkY3J1bWJzIHdpdGggZmlsZS5wYXRoIHRoZSBjdXJyZW50IGhlYWRlcnNcclxuICAgICAgYmxvY2sgPSBmaWxlX2JyZWFkY3J1bWJzO1xyXG4gICAgICBibG9jayArPSBcIjogXCIgKyBjdXJyZW50SGVhZGVycy5tYXAoaGVhZGVyID0+IGhlYWRlci5oZWFkZXIpLmpvaW4oJyA+ICcpO1xyXG4gICAgICBibG9ja19oZWFkaW5ncyA9IFwiI1wiK2N1cnJlbnRIZWFkZXJzLm1hcChoZWFkZXIgPT4gaGVhZGVyLmhlYWRlcikuam9pbignIycpO1xyXG4gICAgICAvLyBpZiBibG9ja19oZWFkaW5ncyBpcyBhbHJlYWR5IGluIGJsb2NrX2hlYWRpbmdzX2xpc3QgdGhlbiBhZGQgYSBudW1iZXIgdG8gdGhlIGVuZFxyXG4gICAgICBpZihibG9ja19oZWFkaW5nc19saXN0LmluZGV4T2YoYmxvY2tfaGVhZGluZ3MpID4gLTEpIHtcclxuICAgICAgICBsZXQgY291bnQgPSAxO1xyXG4gICAgICAgIHdoaWxlKGJsb2NrX2hlYWRpbmdzX2xpc3QuaW5kZXhPZihgJHtibG9ja19oZWFkaW5nc317JHtjb3VudH19YCkgPiAtMSkge1xyXG4gICAgICAgICAgY291bnQrKztcclxuICAgICAgICB9XHJcbiAgICAgICAgYmxvY2tfaGVhZGluZ3MgPSBgJHtibG9ja19oZWFkaW5nc317JHtjb3VudH19YDtcclxuICAgICAgfVxyXG4gICAgICBibG9ja19oZWFkaW5nc19saXN0LnB1c2goYmxvY2tfaGVhZGluZ3MpO1xyXG4gICAgICBibG9ja19wYXRoID0gZmlsZV9wYXRoICsgYmxvY2tfaGVhZGluZ3M7XHJcbiAgICB9XHJcbiAgICAvLyBoYW5kbGUgcmVtYWluaW5nIGFmdGVyIGxvb3BcclxuICAgIGlmKChsYXN0X2hlYWRpbmdfbGluZSAhPT0gKGktMSkpICYmIChibG9jay5pbmRleE9mKFwiXFxuXCIpID4gLTEpICYmIHRoaXMudmFsaWRhdGVfaGVhZGluZ3MoYmxvY2tfaGVhZGluZ3MpKSBvdXRwdXRfYmxvY2soKTtcclxuICAgIC8vIHJlbW92ZSBhbnkgYmxvY2tzIHRoYXQgYXJlIHRvbyBzaG9ydCAobGVuZ3RoIDwgNTApXHJcbiAgICBibG9ja3MgPSBibG9ja3MuZmlsdGVyKGIgPT4gYi5sZW5ndGggPiA1MCk7XHJcbiAgICAvLyBjb25zb2xlLmxvZyhibG9ja3MpO1xyXG4gICAgLy8gcmV0dXJuIHRoZSBibG9ja3MgYXJyYXlcclxuICAgIHJldHVybiBibG9ja3M7XHJcblxyXG4gICAgZnVuY3Rpb24gb3V0cHV0X2Jsb2NrKCkge1xyXG4gICAgICAvLyBicmVhZGNydW1icyBsZW5ndGggKGZpcnN0IGxpbmUgb2YgYmxvY2spXHJcbiAgICAgIGNvbnN0IGJyZWFkY3J1bWJzX2xlbmd0aCA9IGJsb2NrLmluZGV4T2YoXCJcXG5cIikgKyAxO1xyXG4gICAgICBjb25zdCBibG9ja19sZW5ndGggPSBibG9jay5sZW5ndGggLSBicmVhZGNydW1ic19sZW5ndGg7XHJcbiAgICAgIC8vIHRyaW0gYmxvY2sgdG8gbWF4IGxlbmd0aFxyXG4gICAgICBpZiAoYmxvY2subGVuZ3RoID4gTUFYX0VNQkVEX1NUUklOR19MRU5HVEgpIHtcclxuICAgICAgICBibG9jayA9IGJsb2NrLnN1YnN0cmluZygwLCBNQVhfRU1CRURfU1RSSU5HX0xFTkdUSCk7XHJcbiAgICAgIH1cclxuICAgICAgYmxvY2tzLnB1c2goeyB0ZXh0OiBibG9jay50cmltKCksIHBhdGg6IGJsb2NrX3BhdGgsIGxlbmd0aDogYmxvY2tfbGVuZ3RoIH0pO1xyXG4gICAgfVxyXG4gIH1cclxuICAvLyByZXZlcnNlLXJldHJpZXZlIGJsb2NrIGdpdmVuIHBhdGhcclxuICBhc3luYyBibG9ja19yZXRyaWV2ZXIocGF0aCwgbGltaXRzPXt9KSB7XHJcbiAgICBsaW1pdHMgPSB7XHJcbiAgICAgIGxpbmVzOiBudWxsLFxyXG4gICAgICBjaGFyc19wZXJfbGluZTogbnVsbCxcclxuICAgICAgbWF4X2NoYXJzOiBudWxsLFxyXG4gICAgICAuLi5saW1pdHNcclxuICAgIH1cclxuICAgIC8vIHJldHVybiBpZiBubyAjIGluIHBhdGhcclxuICAgIGlmIChwYXRoLmluZGV4T2YoJyMnKSA8IDApIHtcclxuICAgICAgY29uc29sZS5sb2coXCJub3QgYSBibG9jayBwYXRoOiBcIitwYXRoKTtcclxuICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gICAgbGV0IGJsb2NrID0gW107XHJcbiAgICBsZXQgYmxvY2tfaGVhZGluZ3MgPSBwYXRoLnNwbGl0KCcjJykuc2xpY2UoMSk7XHJcbiAgICAvLyBpZiBwYXRoIGVuZHMgd2l0aCBudW1iZXIgaW4gY3VybHkgYnJhY2VzXHJcbiAgICBsZXQgaGVhZGluZ19vY2N1cnJlbmNlID0gMDtcclxuICAgIGlmKGJsb2NrX2hlYWRpbmdzW2Jsb2NrX2hlYWRpbmdzLmxlbmd0aC0xXS5pbmRleE9mKCd7JykgPiAtMSkge1xyXG4gICAgICAvLyBnZXQgdGhlIG9jY3VycmVuY2UgbnVtYmVyXHJcbiAgICAgIGhlYWRpbmdfb2NjdXJyZW5jZSA9IHBhcnNlSW50KGJsb2NrX2hlYWRpbmdzW2Jsb2NrX2hlYWRpbmdzLmxlbmd0aC0xXS5zcGxpdCgneycpWzFdLnJlcGxhY2UoJ30nLCAnJykpO1xyXG4gICAgICAvLyByZW1vdmUgdGhlIG9jY3VycmVuY2UgZnJvbSB0aGUgbGFzdCBoZWFkaW5nXHJcbiAgICAgIGJsb2NrX2hlYWRpbmdzW2Jsb2NrX2hlYWRpbmdzLmxlbmd0aC0xXSA9IGJsb2NrX2hlYWRpbmdzW2Jsb2NrX2hlYWRpbmdzLmxlbmd0aC0xXS5zcGxpdCgneycpWzBdO1xyXG4gICAgfVxyXG4gICAgbGV0IGN1cnJlbnRIZWFkZXJzID0gW107XHJcbiAgICBsZXQgb2NjdXJyZW5jZV9jb3VudCA9IDA7XHJcbiAgICBsZXQgYmVnaW5fbGluZSA9IDA7XHJcbiAgICBsZXQgaSA9IDA7XHJcbiAgICAvLyBnZXQgZmlsZSBwYXRoIGZyb20gcGF0aFxyXG4gICAgY29uc3QgZmlsZV9wYXRoID0gcGF0aC5zcGxpdCgnIycpWzBdO1xyXG4gICAgLy8gZ2V0IGZpbGVcclxuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoZmlsZV9wYXRoKTtcclxuICAgIGlmKCEoZmlsZSBpbnN0YW5jZW9mIE9ic2lkaWFuLlRGaWxlKSkge1xyXG4gICAgICBjb25zb2xlLmxvZyhcIm5vdCBhIGZpbGU6IFwiK2ZpbGVfcGF0aCk7XHJcbiAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICAgIC8vIGdldCBmaWxlIGNvbnRlbnRzXHJcbiAgICBjb25zdCBmaWxlX2NvbnRlbnRzID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKTtcclxuICAgIC8vIHNwbGl0IHRoZSBmaWxlIGNvbnRlbnRzIGludG8gbGluZXNcclxuICAgIGNvbnN0IGxpbmVzID0gZmlsZV9jb250ZW50cy5zcGxpdCgnXFxuJyk7XHJcbiAgICAvLyBsb29wIHRocm91Z2ggdGhlIGxpbmVzXHJcbiAgICBsZXQgaXNfY29kZSA9IGZhbHNlO1xyXG4gICAgZm9yIChpID0gMDsgaSA8IGxpbmVzLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgIC8vIGdldCB0aGUgbGluZVxyXG4gICAgICBjb25zdCBsaW5lID0gbGluZXNbaV07XHJcbiAgICAgIC8vIGlmIGxpbmUgYmVnaW5zIHdpdGggdGhyZWUgYmFja3RpY2tzIHRoZW4gdG9nZ2xlIGlzX2NvZGVcclxuICAgICAgaWYobGluZS5pbmRleE9mKCdgYGAnKSA9PT0gMCkge1xyXG4gICAgICAgIGlzX2NvZGUgPSAhaXNfY29kZTtcclxuICAgICAgfVxyXG4gICAgICAvLyBpZiBpc19jb2RlIGlzIHRydWUgdGhlbiBhZGQgbGluZSB3aXRoIHByZWNlZGluZyB0YWIgYW5kIGNvbnRpbnVlXHJcbiAgICAgIGlmKGlzX2NvZGUpIHtcclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG4gICAgICAvLyBza2lwIGlmIGxpbmUgaXMgZW1wdHkgYnVsbGV0IG9yIGNoZWNrYm94XHJcbiAgICAgIGlmKFsnLSAnLCAnLSBbIF0gJ10uaW5kZXhPZihsaW5lKSA+IC0xKSBjb250aW51ZTtcclxuICAgICAgLy8gaWYgbGluZSBkb2VzIG5vdCBzdGFydCB3aXRoICNcclxuICAgICAgLy8gb3IgaWYgbGluZSBzdGFydHMgd2l0aCAjIGFuZCBzZWNvbmQgY2hhcmFjdGVyIGlzIGEgd29yZCBvciBudW1iZXIgaW5kaWNhdGluZyBhIFwidGFnXCJcclxuICAgICAgLy8gdGhlbiBjb250aW51ZSB0byBuZXh0IGxpbmVcclxuICAgICAgaWYgKCFsaW5lLnN0YXJ0c1dpdGgoJyMnKSB8fCAoWycjJywnICddLmluZGV4T2YobGluZVsxXSkgPCAwKSl7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuICAgICAgLyoqXHJcbiAgICAgICAqIEJFR0lOIEhlYWRpbmcgcGFyc2luZ1xyXG4gICAgICAgKiAtIGxpa2VseSBhIGhlYWRpbmcgaWYgbWFkZSBpdCB0aGlzIGZhclxyXG4gICAgICAgKi9cclxuICAgICAgLy8gZ2V0IHRoZSBoZWFkaW5nIHRleHRcclxuICAgICAgY29uc3QgaGVhZGluZ190ZXh0ID0gbGluZS5yZXBsYWNlKC8jL2csICcnKS50cmltKCk7XHJcbiAgICAgIC8vIGNvbnRpbnVlIGlmIGhlYWRpbmcgdGV4dCBpcyBub3QgaW4gYmxvY2tfaGVhZGluZ3NcclxuICAgICAgY29uc3QgaGVhZGluZ19pbmRleCA9IGJsb2NrX2hlYWRpbmdzLmluZGV4T2YoaGVhZGluZ190ZXh0KTtcclxuICAgICAgaWYgKGhlYWRpbmdfaW5kZXggPCAwKSBjb250aW51ZTtcclxuICAgICAgLy8gaWYgY3VycmVudEhlYWRlcnMubGVuZ3RoICE9PSBoZWFkaW5nX2luZGV4IHRoZW4gd2UgaGF2ZSBhIG1pc21hdGNoXHJcbiAgICAgIGlmIChjdXJyZW50SGVhZGVycy5sZW5ndGggIT09IGhlYWRpbmdfaW5kZXgpIGNvbnRpbnVlO1xyXG4gICAgICAvLyBwdXNoIHRoZSBoZWFkaW5nIHRleHQgdG8gdGhlIGN1cnJlbnRIZWFkZXJzIGFycmF5XHJcbiAgICAgIGN1cnJlbnRIZWFkZXJzLnB1c2goaGVhZGluZ190ZXh0KTtcclxuICAgICAgLy8gaWYgY3VycmVudEhlYWRlcnMubGVuZ3RoID09PSBibG9ja19oZWFkaW5ncy5sZW5ndGggdGhlbiB3ZSBoYXZlIGEgbWF0Y2hcclxuICAgICAgaWYgKGN1cnJlbnRIZWFkZXJzLmxlbmd0aCA9PT0gYmxvY2tfaGVhZGluZ3MubGVuZ3RoKSB7XHJcbiAgICAgICAgLy8gaWYgaGVhZGluZ19vY2N1cnJlbmNlIGlzIGRlZmluZWQgdGhlbiBpbmNyZW1lbnQgb2NjdXJyZW5jZV9jb3VudFxyXG4gICAgICAgIGlmKGhlYWRpbmdfb2NjdXJyZW5jZSA9PT0gMCkge1xyXG4gICAgICAgICAgLy8gc2V0IGJlZ2luX2xpbmUgdG8gaSArIDFcclxuICAgICAgICAgIGJlZ2luX2xpbmUgPSBpICsgMTtcclxuICAgICAgICAgIGJyZWFrOyAvLyBicmVhayBvdXQgb2YgbG9vcFxyXG4gICAgICAgIH1cclxuICAgICAgICAvLyBpZiBvY2N1cnJlbmNlX2NvdW50ICE9PSBoZWFkaW5nX29jY3VycmVuY2UgdGhlbiBjb250aW51ZVxyXG4gICAgICAgIGlmKG9jY3VycmVuY2VfY291bnQgPT09IGhlYWRpbmdfb2NjdXJyZW5jZSl7XHJcbiAgICAgICAgICBiZWdpbl9saW5lID0gaSArIDE7XHJcbiAgICAgICAgICBicmVhazsgLy8gYnJlYWsgb3V0IG9mIGxvb3BcclxuICAgICAgICB9XHJcbiAgICAgICAgb2NjdXJyZW5jZV9jb3VudCsrO1xyXG4gICAgICAgIC8vIHJlc2V0IGN1cnJlbnRIZWFkZXJzXHJcbiAgICAgICAgY3VycmVudEhlYWRlcnMucG9wKCk7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIC8vIGlmIG5vIGJlZ2luX2xpbmUgdGhlbiByZXR1cm4gZmFsc2VcclxuICAgIGlmIChiZWdpbl9saW5lID09PSAwKSByZXR1cm4gZmFsc2U7XHJcbiAgICAvLyBpdGVyYXRlIHRocm91Z2ggbGluZXMgc3RhcnRpbmcgYXQgYmVnaW5fbGluZVxyXG4gICAgaXNfY29kZSA9IGZhbHNlO1xyXG4gICAgLy8gY2hhcmFjdGVyIGFjY3VtdWxhdG9yXHJcbiAgICBsZXQgY2hhcl9jb3VudCA9IDA7XHJcbiAgICBmb3IgKGkgPSBiZWdpbl9saW5lOyBpIDwgbGluZXMubGVuZ3RoOyBpKyspIHtcclxuICAgICAgaWYoKHR5cGVvZiBsaW5lX2xpbWl0ID09PSBcIm51bWJlclwiKSAmJiAoYmxvY2subGVuZ3RoID4gbGluZV9saW1pdCkpe1xyXG4gICAgICAgIGJsb2NrLnB1c2goXCIuLi5cIik7XHJcbiAgICAgICAgYnJlYWs7IC8vIGVuZHMgd2hlbiBsaW5lX2xpbWl0IGlzIHJlYWNoZWRcclxuICAgICAgfVxyXG4gICAgICBsZXQgbGluZSA9IGxpbmVzW2ldO1xyXG4gICAgICBpZiAoKGxpbmUuaW5kZXhPZignIycpID09PSAwKSAmJiAoWycjJywnICddLmluZGV4T2YobGluZVsxXSkgIT09IC0xKSl7XHJcbiAgICAgICAgYnJlYWs7IC8vIGVuZHMgd2hlbiBlbmNvdW50ZXJpbmcgbmV4dCBoZWFkZXJcclxuICAgICAgfVxyXG4gICAgICAvLyBERVBSRUNBVEVEOiBzaG91bGQgYmUgaGFuZGxlZCBieSBuZXdfbGluZStjaGFyX2NvdW50IGNoZWNrIChoYXBwZW5zIGluIHByZXZpb3VzIGl0ZXJhdGlvbilcclxuICAgICAgLy8gaWYgY2hhcl9jb3VudCBpcyBncmVhdGVyIHRoYW4gbGltaXQubWF4X2NoYXJzLCBza2lwXHJcbiAgICAgIGlmIChsaW1pdHMubWF4X2NoYXJzICYmIGNoYXJfY291bnQgPiBsaW1pdHMubWF4X2NoYXJzKSB7XHJcbiAgICAgICAgYmxvY2sucHVzaChcIi4uLlwiKTtcclxuICAgICAgICBicmVhaztcclxuICAgICAgfVxyXG4gICAgICAvLyBpZiBuZXdfbGluZSArIGNoYXJfY291bnQgaXMgZ3JlYXRlciB0aGFuIGxpbWl0Lm1heF9jaGFycywgc2tpcFxyXG4gICAgICBpZiAobGltaXRzLm1heF9jaGFycyAmJiAoKGxpbmUubGVuZ3RoICsgY2hhcl9jb3VudCkgPiBsaW1pdHMubWF4X2NoYXJzKSkge1xyXG4gICAgICAgIGNvbnN0IG1heF9uZXdfY2hhcnMgPSBsaW1pdHMubWF4X2NoYXJzIC0gY2hhcl9jb3VudDtcclxuICAgICAgICBsaW5lID0gbGluZS5zbGljZSgwLCBtYXhfbmV3X2NoYXJzKSArIFwiLi4uXCI7XHJcbiAgICAgICAgYnJlYWs7XHJcbiAgICAgIH1cclxuICAgICAgLy8gdmFsaWRhdGUvZm9ybWF0XHJcbiAgICAgIC8vIGlmIGxpbmUgaXMgZW1wdHksIHNraXBcclxuICAgICAgaWYgKGxpbmUubGVuZ3RoID09PSAwKSBjb250aW51ZTtcclxuICAgICAgLy8gbGltaXQgbGVuZ3RoIG9mIGxpbmUgdG8gTiBjaGFyYWN0ZXJzXHJcbiAgICAgIGlmIChsaW1pdHMuY2hhcnNfcGVyX2xpbmUgJiYgbGluZS5sZW5ndGggPiBsaW1pdHMuY2hhcnNfcGVyX2xpbmUpIHtcclxuICAgICAgICBsaW5lID0gbGluZS5zbGljZSgwLCBsaW1pdHMuY2hhcnNfcGVyX2xpbmUpICsgXCIuLi5cIjtcclxuICAgICAgfVxyXG4gICAgICAvLyBpZiBsaW5lIGlzIGEgY29kZSBibG9jaywgc2tpcFxyXG4gICAgICBpZiAobGluZS5zdGFydHNXaXRoKFwiYGBgXCIpKSB7XHJcbiAgICAgICAgaXNfY29kZSA9ICFpc19jb2RlO1xyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChpc19jb2RlKXtcclxuICAgICAgICAvLyBhZGQgdGFiIHRvIGJlZ2lubmluZyBvZiBsaW5lXHJcbiAgICAgICAgbGluZSA9IFwiXFx0XCIrbGluZTtcclxuICAgICAgfVxyXG4gICAgICAvLyBhZGQgbGluZSB0byBibG9ja1xyXG4gICAgICBibG9jay5wdXNoKGxpbmUpO1xyXG4gICAgICAvLyBpbmNyZW1lbnQgY2hhcl9jb3VudFxyXG4gICAgICBjaGFyX2NvdW50ICs9IGxpbmUubGVuZ3RoO1xyXG4gICAgfVxyXG4gICAgLy8gY2xvc2UgY29kZSBibG9jayBpZiBvcGVuXHJcbiAgICBpZiAoaXNfY29kZSkge1xyXG4gICAgICBibG9jay5wdXNoKFwiYGBgXCIpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGJsb2NrLmpvaW4oXCJcXG5cIikudHJpbSgpO1xyXG4gIH1cclxuXHJcbiAgLy8gcmV0cmlldmUgYSBmaWxlIGZyb20gdGhlIHZhdWx0XHJcbiAgYXN5bmMgZmlsZV9yZXRyaWV2ZXIobGluaywgbGltaXRzPXt9KSB7XHJcbiAgICBsaW1pdHMgPSB7XHJcbiAgICAgIGxpbmVzOiBudWxsLFxyXG4gICAgICBtYXhfY2hhcnM6IG51bGwsXHJcbiAgICAgIGNoYXJzX3Blcl9saW5lOiBudWxsLFxyXG4gICAgICAuLi5saW1pdHNcclxuICAgIH07XHJcbiAgICBjb25zdCB0aGlzX2ZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgobGluayk7XHJcbiAgICAvLyBpZiBmaWxlIGlzIG5vdCBmb3VuZCwgc2tpcFxyXG4gICAgaWYgKCEodGhpc19maWxlIGluc3RhbmNlb2YgT2JzaWRpYW4uVEFic3RyYWN0RmlsZSkpIHJldHVybiBmYWxzZTtcclxuICAgIC8vIHVzZSBjYWNoZWRSZWFkIHRvIGdldCB0aGUgZmlyc3QgMTAgbGluZXMgb2YgdGhlIGZpbGVcclxuICAgIGNvbnN0IGZpbGVfY29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQodGhpc19maWxlKTtcclxuICAgIGNvbnN0IGZpbGVfbGluZXMgPSBmaWxlX2NvbnRlbnQuc3BsaXQoXCJcXG5cIik7XHJcbiAgICBsZXQgZmlyc3RfdGVuX2xpbmVzID0gW107XHJcbiAgICBsZXQgaXNfY29kZSA9IGZhbHNlO1xyXG4gICAgbGV0IGNoYXJfYWNjdW0gPSAwO1xyXG4gICAgY29uc3QgbGluZV9saW1pdCA9IGxpbWl0cy5saW5lcyB8fCBmaWxlX2xpbmVzLmxlbmd0aDtcclxuICAgIGZvciAobGV0IGkgPSAwOyBmaXJzdF90ZW5fbGluZXMubGVuZ3RoIDwgbGluZV9saW1pdDsgaSsrKSB7XHJcbiAgICAgIGxldCBsaW5lID0gZmlsZV9saW5lc1tpXTtcclxuICAgICAgLy8gaWYgbGluZSBpcyB1bmRlZmluZWQsIGJyZWFrXHJcbiAgICAgIGlmICh0eXBlb2YgbGluZSA9PT0gJ3VuZGVmaW5lZCcpXHJcbiAgICAgICAgYnJlYWs7XHJcbiAgICAgIC8vIGlmIGxpbmUgaXMgZW1wdHksIHNraXBcclxuICAgICAgaWYgKGxpbmUubGVuZ3RoID09PSAwKVxyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAvLyBsaW1pdCBsZW5ndGggb2YgbGluZSB0byBOIGNoYXJhY3RlcnNcclxuICAgICAgaWYgKGxpbWl0cy5jaGFyc19wZXJfbGluZSAmJiBsaW5lLmxlbmd0aCA+IGxpbWl0cy5jaGFyc19wZXJfbGluZSkge1xyXG4gICAgICAgIGxpbmUgPSBsaW5lLnNsaWNlKDAsIGxpbWl0cy5jaGFyc19wZXJfbGluZSkgKyBcIi4uLlwiO1xyXG4gICAgICB9XHJcbiAgICAgIC8vIGlmIGxpbmUgaXMgXCItLS1cIiwgc2tpcFxyXG4gICAgICBpZiAobGluZSA9PT0gXCItLS1cIilcclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgLy8gc2tpcCBpZiBsaW5lIGlzIGVtcHR5IGJ1bGxldCBvciBjaGVja2JveFxyXG4gICAgICBpZiAoWyctICcsICctIFsgXSAnXS5pbmRleE9mKGxpbmUpID4gLTEpXHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIC8vIGlmIGxpbmUgaXMgYSBjb2RlIGJsb2NrLCBza2lwXHJcbiAgICAgIGlmIChsaW5lLmluZGV4T2YoXCJgYGBcIikgPT09IDApIHtcclxuICAgICAgICBpc19jb2RlID0gIWlzX2NvZGU7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuICAgICAgLy8gaWYgY2hhcl9hY2N1bSBpcyBncmVhdGVyIHRoYW4gbGltaXQubWF4X2NoYXJzLCBza2lwXHJcbiAgICAgIGlmIChsaW1pdHMubWF4X2NoYXJzICYmIGNoYXJfYWNjdW0gPiBsaW1pdHMubWF4X2NoYXJzKSB7XHJcbiAgICAgICAgZmlyc3RfdGVuX2xpbmVzLnB1c2goXCIuLi5cIik7XHJcbiAgICAgICAgYnJlYWs7XHJcbiAgICAgIH1cclxuICAgICAgaWYgKGlzX2NvZGUpIHtcclxuICAgICAgICAvLyBpZiBpcyBjb2RlLCBhZGQgdGFiIHRvIGJlZ2lubmluZyBvZiBsaW5lXHJcbiAgICAgICAgbGluZSA9IFwiXFx0XCIgKyBsaW5lO1xyXG4gICAgICB9XHJcbiAgICAgIC8vIGlmIGxpbmUgaXMgYSBoZWFkaW5nXHJcbiAgICAgIGlmIChsaW5lX2lzX2hlYWRpbmcobGluZSkpIHtcclxuICAgICAgICAvLyBsb29rIGF0IGxhc3QgbGluZSBpbiBmaXJzdF90ZW5fbGluZXMgdG8gc2VlIGlmIGl0IGlzIGEgaGVhZGluZ1xyXG4gICAgICAgIC8vIG5vdGU6IHVzZXMgbGFzdCBpbiBmaXJzdF90ZW5fbGluZXMsIGluc3RlYWQgb2YgbG9vayBhaGVhZCBpbiBmaWxlX2xpbmVzLCBiZWNhdXNlLi5cclxuICAgICAgICAvLyAuLi5uZXh0IGxpbmUgbWF5IGJlIGV4Y2x1ZGVkIGZyb20gZmlyc3RfdGVuX2xpbmVzIGJ5IHByZXZpb3VzIGlmIHN0YXRlbWVudHNcclxuICAgICAgICBpZiAoKGZpcnN0X3Rlbl9saW5lcy5sZW5ndGggPiAwKSAmJiBsaW5lX2lzX2hlYWRpbmcoZmlyc3RfdGVuX2xpbmVzW2ZpcnN0X3Rlbl9saW5lcy5sZW5ndGggLSAxXSkpIHtcclxuICAgICAgICAgIC8vIGlmIGxhc3QgbGluZSBpcyBhIGhlYWRpbmcsIHJlbW92ZSBpdFxyXG4gICAgICAgICAgZmlyc3RfdGVuX2xpbmVzLnBvcCgpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICAvLyBhZGQgbGluZSB0byBmaXJzdF90ZW5fbGluZXNcclxuICAgICAgZmlyc3RfdGVuX2xpbmVzLnB1c2gobGluZSk7XHJcbiAgICAgIC8vIGluY3JlbWVudCBjaGFyX2FjY3VtXHJcbiAgICAgIGNoYXJfYWNjdW0gKz0gbGluZS5sZW5ndGg7XHJcbiAgICB9XHJcbiAgICAvLyBmb3IgZWFjaCBsaW5lIGluIGZpcnN0X3Rlbl9saW5lcywgYXBwbHkgdmlldy1zcGVjaWZpYyBmb3JtYXR0aW5nXHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGZpcnN0X3Rlbl9saW5lcy5sZW5ndGg7IGkrKykge1xyXG4gICAgICAvLyBpZiBsaW5lIGlzIGEgaGVhZGluZ1xyXG4gICAgICBpZiAobGluZV9pc19oZWFkaW5nKGZpcnN0X3Rlbl9saW5lc1tpXSkpIHtcclxuICAgICAgICAvLyBpZiB0aGlzIGlzIHRoZSBsYXN0IGxpbmUgaW4gZmlyc3RfdGVuX2xpbmVzXHJcbiAgICAgICAgaWYgKGkgPT09IGZpcnN0X3Rlbl9saW5lcy5sZW5ndGggLSAxKSB7XHJcbiAgICAgICAgICAvLyByZW1vdmUgdGhlIGxhc3QgbGluZSBpZiBpdCBpcyBhIGhlYWRpbmdcclxuICAgICAgICAgIGZpcnN0X3Rlbl9saW5lcy5wb3AoKTtcclxuICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIH1cclxuICAgICAgICAvLyByZW1vdmUgaGVhZGluZyBzeW50YXggdG8gaW1wcm92ZSByZWFkYWJpbGl0eSBpbiBzbWFsbCBzcGFjZVxyXG4gICAgICAgIGZpcnN0X3Rlbl9saW5lc1tpXSA9IGZpcnN0X3Rlbl9saW5lc1tpXS5yZXBsYWNlKC8jKy8sIFwiXCIpO1xyXG4gICAgICAgIGZpcnN0X3Rlbl9saW5lc1tpXSA9IGBcXG4ke2ZpcnN0X3Rlbl9saW5lc1tpXX06YDtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgLy8gam9pbiBmaXJzdCB0ZW4gbGluZXMgaW50byBzdHJpbmdcclxuICAgIGZpcnN0X3Rlbl9saW5lcyA9IGZpcnN0X3Rlbl9saW5lcy5qb2luKFwiXFxuXCIpO1xyXG4gICAgcmV0dXJuIGZpcnN0X3Rlbl9saW5lcztcclxuICB9XHJcblxyXG4gIC8vIGl0ZXJhdGUgdGhyb3VnaCBibG9ja3MgYW5kIHNraXAgaWYgYmxvY2tfaGVhZGluZ3MgY29udGFpbnMgdGhpcy5oZWFkZXJfZXhjbHVzaW9uc1xyXG4gIHZhbGlkYXRlX2hlYWRpbmdzKGJsb2NrX2hlYWRpbmdzKSB7XHJcbiAgICBsZXQgdmFsaWQgPSB0cnVlO1xyXG4gICAgaWYgKHRoaXMuaGVhZGVyX2V4Y2x1c2lvbnMubGVuZ3RoID4gMCkge1xyXG4gICAgICBmb3IgKGxldCBrID0gMDsgayA8IHRoaXMuaGVhZGVyX2V4Y2x1c2lvbnMubGVuZ3RoOyBrKyspIHtcclxuICAgICAgICBpZiAoYmxvY2tfaGVhZGluZ3MuaW5kZXhPZih0aGlzLmhlYWRlcl9leGNsdXNpb25zW2tdKSA+IC0xKSB7XHJcbiAgICAgICAgICB2YWxpZCA9IGZhbHNlO1xyXG4gICAgICAgICAgdGhpcy5sb2dfZXhjbHVzaW9uKFwiaGVhZGluZzogXCIrdGhpcy5oZWFkZXJfZXhjbHVzaW9uc1trXSk7XHJcbiAgICAgICAgICBicmVhaztcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIHJldHVybiB2YWxpZDtcclxuICB9XHJcbiAgLy8gcmVuZGVyIFwiU21hcnQgQ29ubmVjdGlvbnNcIiB0ZXh0IGZpeGVkIGluIHRoZSBib3R0b20gcmlnaHQgY29ybmVyXHJcbiAgcmVuZGVyX2JyYW5kKGNvbnRhaW5lciwgbG9jYXRpb249XCJkZWZhdWx0XCIpIHtcclxuICAgIC8vIGlmIGxvY2F0aW9uIGlzIGFsbCB0aGVuIGdldCBPYmplY3Qua2V5cyh0aGlzLnNjX2JyYW5kaW5nKSBhbmQgY2FsbCB0aGlzIGZ1bmN0aW9uIGZvciBlYWNoXHJcbiAgICBpZiAoY29udGFpbmVyID09PSBcImFsbFwiKSB7XHJcbiAgICAgIGNvbnN0IGxvY2F0aW9ucyA9IE9iamVjdC5rZXlzKHRoaXMuc2NfYnJhbmRpbmcpO1xyXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGxvY2F0aW9ucy5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgIHRoaXMucmVuZGVyX2JyYW5kKHRoaXMuc2NfYnJhbmRpbmdbbG9jYXRpb25zW2ldXSwgbG9jYXRpb25zW2ldKTtcclxuICAgICAgfVxyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICAvLyBicmFuZCBjb250YWluZXJcclxuICAgIHRoaXMuc2NfYnJhbmRpbmdbbG9jYXRpb25dID0gY29udGFpbmVyO1xyXG4gICAgLy8gaWYgdGhpcy5zY19icmFuZGluZ1tsb2NhdGlvbl0gY29udGFpbnMgY2hpbGQgd2l0aCBjbGFzcyBcInNjLWJyYW5kXCIsIHJlbW92ZSBpdFxyXG4gICAgaWYgKHRoaXMuc2NfYnJhbmRpbmdbbG9jYXRpb25dLnF1ZXJ5U2VsZWN0b3IoXCIuc2MtYnJhbmRcIikpIHtcclxuICAgICAgdGhpcy5zY19icmFuZGluZ1tsb2NhdGlvbl0ucXVlcnlTZWxlY3RvcihcIi5zYy1icmFuZFwiKS5yZW1vdmUoKTtcclxuICAgIH1cclxuICAgIGNvbnN0IGJyYW5kX2NvbnRhaW5lciA9IHRoaXMuc2NfYnJhbmRpbmdbbG9jYXRpb25dLmNyZWF0ZUVsKFwiZGl2XCIsIHsgY2xzOiBcInNjLWJyYW5kXCIgfSk7XHJcbiAgICAvLyBhZGQgdGV4dFxyXG4gICAgLy8gYWRkIFNWRyBzaWduYWwgaWNvbiB1c2luZyBnZXRJY29uXHJcbiAgICBPYnNpZGlhbi5zZXRJY29uKGJyYW5kX2NvbnRhaW5lciwgXCJzbWFydC1jb25uZWN0aW9uc1wiKTtcclxuICAgIGNvbnN0IGJyYW5kX3AgPSBicmFuZF9jb250YWluZXIuY3JlYXRlRWwoXCJwXCIpO1xyXG4gICAgbGV0IHRleHQgPSBcIlNtYXJ0IENvbm5lY3Rpb25zXCI7XHJcbiAgICBsZXQgYXR0ciA9IHt9O1xyXG4gICAgLy8gaWYgdXBkYXRlIGF2YWlsYWJsZSwgY2hhbmdlIHRleHQgdG8gXCJVcGRhdGUgQXZhaWxhYmxlXCJcclxuICAgIGlmICh0aGlzLnVwZGF0ZV9hdmFpbGFibGUpIHtcclxuICAgICAgdGV4dCA9IFwiVXBkYXRlIEF2YWlsYWJsZVwiO1xyXG4gICAgICBhdHRyID0ge1xyXG4gICAgICAgIHN0eWxlOiBcImZvbnQtd2VpZ2h0OiA3MDA7XCJcclxuICAgICAgfTtcclxuICAgIH1cclxuICAgIGJyYW5kX3AuY3JlYXRlRWwoXCJhXCIsIHtcclxuICAgICAgY2xzOiBcIlwiLFxyXG4gICAgICB0ZXh0OiB0ZXh0LFxyXG4gICAgICBocmVmOiBcImh0dHBzOi8vZ2l0aHViLmNvbS9icmlhbnBldHJvL29ic2lkaWFuLXNtYXJ0LWNvbm5lY3Rpb25zL2Rpc2N1c3Npb25zXCIsXHJcbiAgICAgIHRhcmdldDogXCJfYmxhbmtcIixcclxuICAgICAgYXR0cjogYXR0clxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuXHJcbiAgLy8gY3JlYXRlIGxpc3Qgb2YgbmVhcmVzdCBub3Rlc1xyXG4gIGFzeW5jIHVwZGF0ZV9yZXN1bHRzKGNvbnRhaW5lciwgbmVhcmVzdCkge1xyXG4gICAgbGV0IGxpc3Q7XHJcbiAgICAvLyBjaGVjayBpZiBsaXN0IGV4aXN0c1xyXG4gICAgaWYoKGNvbnRhaW5lci5jaGlsZHJlbi5sZW5ndGggPiAxKSAmJiAoY29udGFpbmVyLmNoaWxkcmVuWzFdLmNsYXNzTGlzdC5jb250YWlucyhcInNjLWxpc3RcIikpKXtcclxuICAgICAgbGlzdCA9IGNvbnRhaW5lci5jaGlsZHJlblsxXTtcclxuICAgIH1cclxuICAgIC8vIGlmIGxpc3QgZXhpc3RzLCBlbXB0eSBpdFxyXG4gICAgaWYgKGxpc3QpIHtcclxuICAgICAgbGlzdC5lbXB0eSgpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgLy8gY3JlYXRlIGxpc3QgZWxlbWVudFxyXG4gICAgICBsaXN0ID0gY29udGFpbmVyLmNyZWF0ZUVsKFwiZGl2XCIsIHsgY2xzOiBcInNjLWxpc3RcIiB9KTtcclxuICAgIH1cclxuICAgIGxldCBzZWFyY2hfcmVzdWx0X2NsYXNzID0gXCJzZWFyY2gtcmVzdWx0XCI7XHJcbiAgICAvLyBpZiBzZXR0aW5ncyBleHBhbmRlZF92aWV3IGlzIGZhbHNlLCBhZGQgc2MtY29sbGFwc2VkIGNsYXNzXHJcbiAgICBpZighdGhpcy5zZXR0aW5ncy5leHBhbmRlZF92aWV3KSBzZWFyY2hfcmVzdWx0X2NsYXNzICs9IFwiIHNjLWNvbGxhcHNlZFwiO1xyXG5cclxuICAgIC8vIFRPRE86IGFkZCBvcHRpb24gdG8gZ3JvdXAgbmVhcmVzdCBieSBmaWxlXHJcbiAgICBpZighdGhpcy5zZXR0aW5ncy5ncm91cF9uZWFyZXN0X2J5X2ZpbGUpIHtcclxuICAgICAgLy8gZm9yIGVhY2ggbmVhcmVzdCBub3RlXHJcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbmVhcmVzdC5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgIC8qKlxyXG4gICAgICAgICAqIEJFR0lOIEVYVEVSTkFMIExJTksgTE9HSUNcclxuICAgICAgICAgKiBpZiBsaW5rIGlzIGFuIG9iamVjdCwgaXQgaW5kaWNhdGVzIGV4dGVybmFsIGxpbmtcclxuICAgICAgICAgKi9cclxuICAgICAgICBpZiAodHlwZW9mIG5lYXJlc3RbaV0ubGluayA9PT0gXCJvYmplY3RcIikge1xyXG4gICAgICAgICAgY29uc3QgaXRlbSA9IGxpc3QuY3JlYXRlRWwoXCJkaXZcIiwgeyBjbHM6IFwic2VhcmNoLXJlc3VsdFwiIH0pO1xyXG4gICAgICAgICAgY29uc3QgbGluayA9IGl0ZW0uY3JlYXRlRWwoXCJhXCIsIHtcclxuICAgICAgICAgICAgY2xzOiBcInNlYXJjaC1yZXN1bHQtZmlsZS10aXRsZSBpcy1jbGlja2FibGVcIixcclxuICAgICAgICAgICAgaHJlZjogbmVhcmVzdFtpXS5saW5rLnBhdGgsXHJcbiAgICAgICAgICAgIHRpdGxlOiBuZWFyZXN0W2ldLmxpbmsudGl0bGUsXHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICAgIGxpbmsuaW5uZXJIVE1MID0gdGhpcy5yZW5kZXJfZXh0ZXJuYWxfbGlua19lbG0obmVhcmVzdFtpXS5saW5rKTtcclxuICAgICAgICAgIGl0ZW0uc2V0QXR0cignZHJhZ2dhYmxlJywgJ3RydWUnKVxyXG4gICAgICAgICAgY29udGludWU7IC8vIGVuZHMgaGVyZSBmb3IgZXh0ZXJuYWwgbGlua3NcclxuICAgICAgICB9XHJcbiAgICAgICAgLyoqXHJcbiAgICAgICAgICogQkVHSU4gSU5URVJOQUwgTElOSyBMT0dJQ1xyXG4gICAgICAgICAqIGlmIGxpbmsgaXMgYSBzdHJpbmcsIGl0IGluZGljYXRlcyBpbnRlcm5hbCBsaW5rXHJcbiAgICAgICAgICovXHJcbiAgICAgICAgbGV0IGZpbGVfbGlua190ZXh0O1xyXG4gICAgICAgIGNvbnN0IGZpbGVfc2ltaWxhcml0eV9wY3QgPSBNYXRoLnJvdW5kKG5lYXJlc3RbaV0uc2ltaWxhcml0eSAqIDEwMCkgKyBcIiVcIjtcclxuICAgICAgICBpZih0aGlzLnNldHRpbmdzLnNob3dfZnVsbF9wYXRoKSB7XHJcbiAgICAgICAgICBjb25zdCBwY3MgPSBuZWFyZXN0W2ldLmxpbmsuc3BsaXQoXCIvXCIpO1xyXG4gICAgICAgICAgZmlsZV9saW5rX3RleHQgPSBwY3NbcGNzLmxlbmd0aCAtIDFdO1xyXG4gICAgICAgICAgY29uc3QgcGF0aCA9IHBjcy5zbGljZSgwLCBwY3MubGVuZ3RoIC0gMSkuam9pbihcIi9cIik7XHJcbiAgICAgICAgICAvLyBmaWxlX2xpbmtfdGV4dCA9IGA8c21hbGw+JHtwYXRofSB8ICR7ZmlsZV9zaW1pbGFyaXR5X3BjdH08L3NtYWxsPjxicj4ke2ZpbGVfbGlua190ZXh0fWA7XHJcbiAgICAgICAgICBmaWxlX2xpbmtfdGV4dCA9IGA8c21hbGw+JHtmaWxlX3NpbWlsYXJpdHlfcGN0fSB8ICR7cGF0aH0gfCAke2ZpbGVfbGlua190ZXh0fTwvc21hbGw+YDtcclxuICAgICAgICB9ZWxzZXtcclxuICAgICAgICAgIGZpbGVfbGlua190ZXh0ID0gJzxzbWFsbD4nICsgZmlsZV9zaW1pbGFyaXR5X3BjdCArIFwiIHwgXCIgKyBuZWFyZXN0W2ldLmxpbmsuc3BsaXQoXCIvXCIpLnBvcCgpICsgJzwvc21hbGw+JztcclxuICAgICAgICB9XHJcbiAgICAgICAgLy8gc2tpcCBjb250ZW50cyByZW5kZXJpbmcgaWYgaW5jb21wYXRpYmxlIGZpbGUgdHlwZVxyXG4gICAgICAgIC8vIGV4LiBub3QgbWFya2Rvd24gZmlsZSBvciBjb250YWlucyBubyAnLmV4Y2FsaWRyYXcnXHJcbiAgICAgICAgaWYoIXRoaXMucmVuZGVyYWJsZV9maWxlX3R5cGUobmVhcmVzdFtpXS5saW5rKSl7XHJcbiAgICAgICAgICBjb25zdCBpdGVtID0gbGlzdC5jcmVhdGVFbChcImRpdlwiLCB7IGNsczogXCJzZWFyY2gtcmVzdWx0XCIgfSk7XHJcbiAgICAgICAgICBjb25zdCBsaW5rID0gaXRlbS5jcmVhdGVFbChcImFcIiwge1xyXG4gICAgICAgICAgICBjbHM6IFwic2VhcmNoLXJlc3VsdC1maWxlLXRpdGxlIGlzLWNsaWNrYWJsZVwiLFxyXG4gICAgICAgICAgICBocmVmOiBuZWFyZXN0W2ldLmxpbmssXHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICAgIGxpbmsuaW5uZXJIVE1MID0gZmlsZV9saW5rX3RleHQ7XHJcbiAgICAgICAgICAvLyBkcmFnIGFuZCBkcm9wXHJcbiAgICAgICAgICBpdGVtLnNldEF0dHIoJ2RyYWdnYWJsZScsICd0cnVlJylcclxuICAgICAgICAgIC8vIGFkZCBsaXN0ZW5lcnMgdG8gbGlua1xyXG4gICAgICAgICAgdGhpcy5hZGRfbGlua19saXN0ZW5lcnMobGluaywgbmVhcmVzdFtpXSwgaXRlbSk7XHJcbiAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIHJlbW92ZSBmaWxlIGV4dGVuc2lvbiBpZiAubWQgYW5kIG1ha2UgIyBpbnRvID5cclxuICAgICAgICBmaWxlX2xpbmtfdGV4dCA9IGZpbGVfbGlua190ZXh0LnJlcGxhY2UoXCIubWRcIiwgXCJcIikucmVwbGFjZSgvIy9nLCBcIiA+IFwiKTtcclxuICAgICAgICAvLyBjcmVhdGUgaXRlbVxyXG4gICAgICAgIGNvbnN0IGl0ZW0gPSBsaXN0LmNyZWF0ZUVsKFwiZGl2XCIsIHsgY2xzOiBzZWFyY2hfcmVzdWx0X2NsYXNzIH0pO1xyXG4gICAgICAgIC8vIGNyZWF0ZSBzcGFuIGZvciB0b2dnbGVcclxuICAgICAgICBjb25zdCB0b2dnbGUgPSBpdGVtLmNyZWF0ZUVsKFwic3BhblwiLCB7IGNsczogXCJpcy1jbGlja2FibGVcIiB9KTtcclxuICAgICAgICAvLyBpbnNlcnQgcmlnaHQgdHJpYW5nbGUgc3ZnIGFzIHRvZ2dsZVxyXG4gICAgICAgIE9ic2lkaWFuLnNldEljb24odG9nZ2xlLCBcInJpZ2h0LXRyaWFuZ2xlXCIpOyAvLyBtdXN0IGNvbWUgYmVmb3JlIGFkZGluZyBvdGhlciBlbG1zIHRvIHByZXZlbnQgb3ZlcndyaXRlXHJcbiAgICAgICAgY29uc3QgbGluayA9IHRvZ2dsZS5jcmVhdGVFbChcImFcIiwge1xyXG4gICAgICAgICAgY2xzOiBcInNlYXJjaC1yZXN1bHQtZmlsZS10aXRsZVwiLFxyXG4gICAgICAgICAgdGl0bGU6IG5lYXJlc3RbaV0ubGluayxcclxuICAgICAgICB9KTtcclxuICAgICAgICBsaW5rLmlubmVySFRNTCA9IGZpbGVfbGlua190ZXh0O1xyXG4gICAgICAgIC8vIGFkZCBsaXN0ZW5lcnMgdG8gbGlua1xyXG4gICAgICAgIHRoaXMuYWRkX2xpbmtfbGlzdGVuZXJzKGxpbmssIG5lYXJlc3RbaV0sIGl0ZW0pO1xyXG4gICAgICAgIHRvZ2dsZS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiB7XHJcbiAgICAgICAgICAvLyBmaW5kIHBhcmVudCBjb250YWluaW5nIHNlYXJjaC1yZXN1bHQgY2xhc3NcclxuICAgICAgICAgIGxldCBwYXJlbnQgPSBldmVudC50YXJnZXQucGFyZW50RWxlbWVudDtcclxuICAgICAgICAgIHdoaWxlICghcGFyZW50LmNsYXNzTGlzdC5jb250YWlucyhcInNlYXJjaC1yZXN1bHRcIikpIHtcclxuICAgICAgICAgICAgcGFyZW50ID0gcGFyZW50LnBhcmVudEVsZW1lbnQ7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICAvLyB0b2dnbGUgc2MtY29sbGFwc2VkIGNsYXNzXHJcbiAgICAgICAgICBwYXJlbnQuY2xhc3NMaXN0LnRvZ2dsZShcInNjLWNvbGxhcHNlZFwiKTtcclxuICAgICAgICB9KTtcclxuICAgICAgICBjb25zdCBjb250ZW50cyA9IGl0ZW0uY3JlYXRlRWwoXCJ1bFwiLCB7IGNsczogXCJcIiB9KTtcclxuICAgICAgICBjb25zdCBjb250ZW50c19jb250YWluZXIgPSBjb250ZW50cy5jcmVhdGVFbChcImxpXCIsIHtcclxuICAgICAgICAgIGNsczogXCJzZWFyY2gtcmVzdWx0LWZpbGUtdGl0bGUgaXMtY2xpY2thYmxlXCIsXHJcbiAgICAgICAgICB0aXRsZTogbmVhcmVzdFtpXS5saW5rLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGlmKG5lYXJlc3RbaV0ubGluay5pbmRleE9mKFwiI1wiKSA+IC0xKXsgLy8gaXMgYmxvY2tcclxuICAgICAgICAgIE9ic2lkaWFuLk1hcmtkb3duUmVuZGVyZXIucmVuZGVyTWFya2Rvd24oKGF3YWl0IHRoaXMuYmxvY2tfcmV0cmlldmVyKG5lYXJlc3RbaV0ubGluaywge2xpbmVzOiAxMCwgbWF4X2NoYXJzOiAxMDAwfSkpLCBjb250ZW50c19jb250YWluZXIsIG5lYXJlc3RbaV0ubGluaywgbmV3IE9ic2lkaWFuLkNvbXBvbmVudCgpKTtcclxuICAgICAgICB9ZWxzZXsgLy8gaXMgZmlsZVxyXG4gICAgICAgICAgY29uc3QgZmlyc3RfdGVuX2xpbmVzID0gYXdhaXQgdGhpcy5maWxlX3JldHJpZXZlcihuZWFyZXN0W2ldLmxpbmssIHtsaW5lczogMTAsIG1heF9jaGFyczogMTAwMH0pO1xyXG4gICAgICAgICAgaWYoIWZpcnN0X3Rlbl9saW5lcykgY29udGludWU7IC8vIHNraXAgaWYgZmlsZSBpcyBlbXB0eVxyXG4gICAgICAgICAgT2JzaWRpYW4uTWFya2Rvd25SZW5kZXJlci5yZW5kZXJNYXJrZG93bihmaXJzdF90ZW5fbGluZXMsIGNvbnRlbnRzX2NvbnRhaW5lciwgbmVhcmVzdFtpXS5saW5rLCBuZXcgT2JzaWRpYW4uQ29tcG9uZW50KCkpO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0aGlzLmFkZF9saW5rX2xpc3RlbmVycyhjb250ZW50cywgbmVhcmVzdFtpXSwgaXRlbSk7XHJcbiAgICAgIH1cclxuICAgICAgdGhpcy5yZW5kZXJfYnJhbmQoY29udGFpbmVyLCBcImJsb2NrXCIpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgLy8gZ3JvdXAgbmVhcmVzdCBieSBmaWxlXHJcbiAgICBjb25zdCBuZWFyZXN0X2J5X2ZpbGUgPSB7fTtcclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbmVhcmVzdC5sZW5ndGg7IGkrKykge1xyXG4gICAgICBjb25zdCBjdXJyID0gbmVhcmVzdFtpXTtcclxuICAgICAgY29uc3QgbGluayA9IGN1cnIubGluaztcclxuICAgICAgLy8gc2tpcCBpZiBsaW5rIGlzIGFuIG9iamVjdCAoaW5kaWNhdGVzIGV4dGVybmFsIGxvZ2ljKVxyXG4gICAgICBpZiAodHlwZW9mIGxpbmsgPT09IFwib2JqZWN0XCIpIHtcclxuICAgICAgICBuZWFyZXN0X2J5X2ZpbGVbbGluay5wYXRoXSA9IFtjdXJyXTtcclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG4gICAgICBpZiAobGluay5pbmRleE9mKFwiI1wiKSA+IC0xKSB7XHJcbiAgICAgICAgY29uc3QgZmlsZV9wYXRoID0gbGluay5zcGxpdChcIiNcIilbMF07XHJcbiAgICAgICAgaWYgKCFuZWFyZXN0X2J5X2ZpbGVbZmlsZV9wYXRoXSkge1xyXG4gICAgICAgICAgbmVhcmVzdF9ieV9maWxlW2ZpbGVfcGF0aF0gPSBbXTtcclxuICAgICAgICB9XHJcbiAgICAgICAgbmVhcmVzdF9ieV9maWxlW2ZpbGVfcGF0aF0ucHVzaChuZWFyZXN0W2ldKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBpZiAoIW5lYXJlc3RfYnlfZmlsZVtsaW5rXSkge1xyXG4gICAgICAgICAgbmVhcmVzdF9ieV9maWxlW2xpbmtdID0gW107XHJcbiAgICAgICAgfVxyXG4gICAgICAgIC8vIGFsd2F5cyBhZGQgdG8gZnJvbnQgb2YgYXJyYXlcclxuICAgICAgICBuZWFyZXN0X2J5X2ZpbGVbbGlua10udW5zaGlmdChuZWFyZXN0W2ldKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgLy8gZm9yIGVhY2ggZmlsZVxyXG4gICAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKG5lYXJlc3RfYnlfZmlsZSk7XHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGtleXMubGVuZ3RoOyBpKyspIHtcclxuICAgICAgY29uc3QgZmlsZSA9IG5lYXJlc3RfYnlfZmlsZVtrZXlzW2ldXTtcclxuICAgICAgLyoqXHJcbiAgICAgICAqIEJlZ2luIGV4dGVybmFsIGxpbmsgaGFuZGxpbmdcclxuICAgICAgICovXHJcbiAgICAgIC8vIGlmIGxpbmsgaXMgYW4gb2JqZWN0IChpbmRpY2F0ZXMgdjIgbG9naWMpXHJcbiAgICAgIGlmICh0eXBlb2YgZmlsZVswXS5saW5rID09PSBcIm9iamVjdFwiKSB7XHJcbiAgICAgICAgY29uc3QgY3VyciA9IGZpbGVbMF07XHJcbiAgICAgICAgY29uc3QgbWV0YSA9IGN1cnIubGluaztcclxuICAgICAgICBpZiAobWV0YS5wYXRoLnN0YXJ0c1dpdGgoXCJodHRwXCIpKSB7XHJcbiAgICAgICAgICBjb25zdCBpdGVtID0gbGlzdC5jcmVhdGVFbChcImRpdlwiLCB7IGNsczogXCJzZWFyY2gtcmVzdWx0XCIgfSk7XHJcbiAgICAgICAgICBjb25zdCBsaW5rID0gaXRlbS5jcmVhdGVFbChcImFcIiwge1xyXG4gICAgICAgICAgICBjbHM6IFwic2VhcmNoLXJlc3VsdC1maWxlLXRpdGxlIGlzLWNsaWNrYWJsZVwiLFxyXG4gICAgICAgICAgICBocmVmOiBtZXRhLnBhdGgsXHJcbiAgICAgICAgICAgIHRpdGxlOiBtZXRhLnRpdGxlLFxyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgICBsaW5rLmlubmVySFRNTCA9IHRoaXMucmVuZGVyX2V4dGVybmFsX2xpbmtfZWxtKG1ldGEpO1xyXG4gICAgICAgICAgaXRlbS5zZXRBdHRyKCdkcmFnZ2FibGUnLCAndHJ1ZScpO1xyXG4gICAgICAgICAgY29udGludWU7IC8vIGVuZHMgaGVyZSBmb3IgZXh0ZXJuYWwgbGlua3NcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgLyoqXHJcbiAgICAgICAqIEhhbmRsZXMgSW50ZXJuYWxcclxuICAgICAgICovXHJcbiAgICAgIGxldCBmaWxlX2xpbmtfdGV4dDtcclxuICAgICAgY29uc3QgZmlsZV9zaW1pbGFyaXR5X3BjdCA9IE1hdGgucm91bmQoZmlsZVswXS5zaW1pbGFyaXR5ICogMTAwKSArIFwiJVwiO1xyXG4gICAgICBpZiAodGhpcy5zZXR0aW5ncy5zaG93X2Z1bGxfcGF0aCkge1xyXG4gICAgICAgIGNvbnN0IHBjcyA9IGZpbGVbMF0ubGluay5zcGxpdChcIi9cIik7XHJcbiAgICAgICAgZmlsZV9saW5rX3RleHQgPSBwY3NbcGNzLmxlbmd0aCAtIDFdO1xyXG4gICAgICAgIGNvbnN0IHBhdGggPSBwY3Muc2xpY2UoMCwgcGNzLmxlbmd0aCAtIDEpLmpvaW4oXCIvXCIpO1xyXG4gICAgICAgIGZpbGVfbGlua190ZXh0ID0gYDxzbWFsbD4ke3BhdGh9IHwgJHtmaWxlX3NpbWlsYXJpdHlfcGN0fTwvc21hbGw+PGJyPiR7ZmlsZV9saW5rX3RleHR9YDtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBmaWxlX2xpbmtfdGV4dCA9IGZpbGVbMF0ubGluay5zcGxpdChcIi9cIikucG9wKCk7XHJcbiAgICAgICAgLy8gYWRkIHNpbWlsYXJpdHkgcGVyY2VudGFnZVxyXG4gICAgICAgIGZpbGVfbGlua190ZXh0ICs9ICcgfCAnICsgZmlsZV9zaW1pbGFyaXR5X3BjdDtcclxuICAgICAgfVxyXG5cclxuXHJcbiAgICAgICAgXHJcbiAgICAgIC8vIHNraXAgY29udGVudHMgcmVuZGVyaW5nIGlmIGluY29tcGF0aWJsZSBmaWxlIHR5cGVcclxuICAgICAgLy8gZXguIG5vdCBtYXJrZG93biBvciBjb250YWlucyAnLmV4Y2FsaWRyYXcnXHJcbiAgICAgIGlmKCF0aGlzLnJlbmRlcmFibGVfZmlsZV90eXBlKGZpbGVbMF0ubGluaykpIHtcclxuICAgICAgICBjb25zdCBpdGVtID0gbGlzdC5jcmVhdGVFbChcImRpdlwiLCB7IGNsczogXCJzZWFyY2gtcmVzdWx0XCIgfSk7XHJcbiAgICAgICAgY29uc3QgZmlsZV9saW5rID0gaXRlbS5jcmVhdGVFbChcImFcIiwge1xyXG4gICAgICAgICAgY2xzOiBcInNlYXJjaC1yZXN1bHQtZmlsZS10aXRsZSBpcy1jbGlja2FibGVcIixcclxuICAgICAgICAgIHRpdGxlOiBmaWxlWzBdLmxpbmssXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgZmlsZV9saW5rLmlubmVySFRNTCA9IGZpbGVfbGlua190ZXh0O1xyXG4gICAgICAgIC8vIGFkZCBsaW5rIGxpc3RlbmVycyB0byBmaWxlIGxpbmtcclxuICAgICAgICB0aGlzLmFkZF9saW5rX2xpc3RlbmVycyhmaWxlX2xpbmssIGZpbGVbMF0sIGl0ZW0pO1xyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcblxyXG5cclxuICAgICAgLy8gcmVtb3ZlIGZpbGUgZXh0ZW5zaW9uIGlmIC5tZFxyXG4gICAgICBmaWxlX2xpbmtfdGV4dCA9IGZpbGVfbGlua190ZXh0LnJlcGxhY2UoXCIubWRcIiwgXCJcIikucmVwbGFjZSgvIy9nLCBcIiA+IFwiKTtcclxuICAgICAgY29uc3QgaXRlbSA9IGxpc3QuY3JlYXRlRWwoXCJkaXZcIiwgeyBjbHM6IHNlYXJjaF9yZXN1bHRfY2xhc3MgfSk7XHJcbiAgICAgIGNvbnN0IHRvZ2dsZSA9IGl0ZW0uY3JlYXRlRWwoXCJzcGFuXCIsIHsgY2xzOiBcImlzLWNsaWNrYWJsZVwiIH0pO1xyXG4gICAgICAvLyBpbnNlcnQgcmlnaHQgdHJpYW5nbGUgc3ZnIGljb24gYXMgdG9nZ2xlIGJ1dHRvbiBpbiBzcGFuXHJcbiAgICAgIE9ic2lkaWFuLnNldEljb24odG9nZ2xlLCBcInJpZ2h0LXRyaWFuZ2xlXCIpOyAvLyBtdXN0IGNvbWUgYmVmb3JlIGFkZGluZyBvdGhlciBlbG1zIGVsc2Ugb3ZlcndyaXRlc1xyXG4gICAgICBjb25zdCBmaWxlX2xpbmsgPSB0b2dnbGUuY3JlYXRlRWwoXCJhXCIsIHtcclxuICAgICAgICBjbHM6IFwic2VhcmNoLXJlc3VsdC1maWxlLXRpdGxlXCIsXHJcbiAgICAgICAgdGl0bGU6IGZpbGVbMF0ubGluayxcclxuICAgICAgfSk7XHJcbiAgICAgIGZpbGVfbGluay5pbm5lckhUTUwgPSBmaWxlX2xpbmtfdGV4dDtcclxuICAgICAgLy8gYWRkIGxpbmsgbGlzdGVuZXJzIHRvIGZpbGUgbGlua1xyXG4gICAgICB0aGlzLmFkZF9saW5rX2xpc3RlbmVycyhmaWxlX2xpbmssIGZpbGVbMF0sIHRvZ2dsZSk7XHJcbiAgICAgIHRvZ2dsZS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiB7XHJcbiAgICAgICAgLy8gZmluZCBwYXJlbnQgY29udGFpbmluZyBjbGFzcyBzZWFyY2gtcmVzdWx0XHJcbiAgICAgICAgbGV0IHBhcmVudCA9IGV2ZW50LnRhcmdldDtcclxuICAgICAgICB3aGlsZSAoIXBhcmVudC5jbGFzc0xpc3QuY29udGFpbnMoXCJzZWFyY2gtcmVzdWx0XCIpKSB7XHJcbiAgICAgICAgICBwYXJlbnQgPSBwYXJlbnQucGFyZW50RWxlbWVudDtcclxuICAgICAgICB9XHJcbiAgICAgICAgcGFyZW50LmNsYXNzTGlzdC50b2dnbGUoXCJzYy1jb2xsYXBzZWRcIik7XHJcbiAgICAgICAgLy8gVE9ETzogaWYgYmxvY2sgY29udGFpbmVyIGlzIGVtcHR5LCByZW5kZXIgbWFya2Rvd24gZnJvbSBibG9jayByZXRyaWV2ZXJcclxuICAgICAgfSk7XHJcbiAgICAgIGNvbnN0IGZpbGVfbGlua19saXN0ID0gaXRlbS5jcmVhdGVFbChcInVsXCIpO1xyXG4gICAgICAvLyBmb3IgZWFjaCBsaW5rIGluIGZpbGVcclxuICAgICAgZm9yIChsZXQgaiA9IDA7IGogPCBmaWxlLmxlbmd0aDsgaisrKSB7XHJcbiAgICAgICAgLy8gaWYgaXMgYSBibG9jayAoaGFzICMgaW4gbGluaylcclxuICAgICAgICBpZihmaWxlW2pdLmxpbmsuaW5kZXhPZihcIiNcIikgPiAtMSkge1xyXG4gICAgICAgICAgY29uc3QgYmxvY2sgPSBmaWxlW2pdO1xyXG4gICAgICAgICAgY29uc3QgYmxvY2tfbGluayA9IGZpbGVfbGlua19saXN0LmNyZWF0ZUVsKFwibGlcIiwge1xyXG4gICAgICAgICAgICBjbHM6IFwic2VhcmNoLXJlc3VsdC1maWxlLXRpdGxlIGlzLWNsaWNrYWJsZVwiLFxyXG4gICAgICAgICAgICB0aXRsZTogYmxvY2subGluayxcclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgLy8gc2tpcCBibG9jayBjb250ZXh0IGlmIGZpbGUubGVuZ3RoID09PSAxIGJlY2F1c2UgYWxyZWFkeSBhZGRlZFxyXG4gICAgICAgICAgaWYoZmlsZS5sZW5ndGggPiAxKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGJsb2NrX2NvbnRleHQgPSB0aGlzLnJlbmRlcl9ibG9ja19jb250ZXh0KGJsb2NrKTtcclxuICAgICAgICAgICAgY29uc3QgYmxvY2tfc2ltaWxhcml0eV9wY3QgPSBNYXRoLnJvdW5kKGJsb2NrLnNpbWlsYXJpdHkgKiAxMDApICsgXCIlXCI7XHJcbiAgICAgICAgICAgIGJsb2NrX2xpbmsuaW5uZXJIVE1MID0gYDxzbWFsbD4ke2Jsb2NrX2NvbnRleHR9IHwgJHtibG9ja19zaW1pbGFyaXR5X3BjdH08L3NtYWxsPmA7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBjb25zdCBibG9ja19jb250YWluZXIgPSBibG9ja19saW5rLmNyZWF0ZUVsKFwiZGl2XCIpO1xyXG4gICAgICAgICAgLy8gVE9ETzogbW92ZSB0byByZW5kZXJpbmcgb24gZXhwYW5kaW5nIHNlY3Rpb24gKHRvZ2dsZSBjb2xsYXBzZWQpXHJcbiAgICAgICAgICBPYnNpZGlhbi5NYXJrZG93blJlbmRlcmVyLnJlbmRlck1hcmtkb3duKChhd2FpdCB0aGlzLmJsb2NrX3JldHJpZXZlcihibG9jay5saW5rLCB7bGluZXM6IDEwLCBtYXhfY2hhcnM6IDEwMDB9KSksIGJsb2NrX2NvbnRhaW5lciwgYmxvY2subGluaywgbmV3IE9ic2lkaWFuLkNvbXBvbmVudCgpKTtcclxuICAgICAgICAgIC8vIGFkZCBsaW5rIGxpc3RlbmVycyB0byBibG9jayBsaW5rXHJcbiAgICAgICAgICB0aGlzLmFkZF9saW5rX2xpc3RlbmVycyhibG9ja19saW5rLCBibG9jaywgZmlsZV9saW5rX2xpc3QpO1xyXG4gICAgICAgIH1lbHNle1xyXG4gICAgICAgICAgLy8gZ2V0IGZpcnN0IHRlbiBsaW5lcyBvZiBmaWxlXHJcbiAgICAgICAgICBjb25zdCBmaWxlX2xpbmtfbGlzdCA9IGl0ZW0uY3JlYXRlRWwoXCJ1bFwiKTtcclxuICAgICAgICAgIGNvbnN0IGJsb2NrX2xpbmsgPSBmaWxlX2xpbmtfbGlzdC5jcmVhdGVFbChcImxpXCIsIHtcclxuICAgICAgICAgICAgY2xzOiBcInNlYXJjaC1yZXN1bHQtZmlsZS10aXRsZSBpcy1jbGlja2FibGVcIixcclxuICAgICAgICAgICAgdGl0bGU6IGZpbGVbMF0ubGluayxcclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgY29uc3QgYmxvY2tfY29udGFpbmVyID0gYmxvY2tfbGluay5jcmVhdGVFbChcImRpdlwiKTtcclxuICAgICAgICAgIGxldCBmaXJzdF90ZW5fbGluZXMgPSBhd2FpdCB0aGlzLmZpbGVfcmV0cmlldmVyKGZpbGVbMF0ubGluaywge2xpbmVzOiAxMCwgbWF4X2NoYXJzOiAxMDAwfSk7XHJcbiAgICAgICAgICBpZighZmlyc3RfdGVuX2xpbmVzKSBjb250aW51ZTsgLy8gaWYgZmlsZSBub3QgZm91bmQsIHNraXBcclxuICAgICAgICAgIE9ic2lkaWFuLk1hcmtkb3duUmVuZGVyZXIucmVuZGVyTWFya2Rvd24oZmlyc3RfdGVuX2xpbmVzLCBibG9ja19jb250YWluZXIsIGZpbGVbMF0ubGluaywgbmV3IE9ic2lkaWFuLkNvbXBvbmVudCgpKTtcclxuICAgICAgICAgIHRoaXMuYWRkX2xpbmtfbGlzdGVuZXJzKGJsb2NrX2xpbmssIGZpbGVbMF0sIGZpbGVfbGlua19saXN0KTtcclxuXHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICB0aGlzLnJlbmRlcl9icmFuZChjb250YWluZXIsIFwiZmlsZVwiKTtcclxuICB9XHJcblxyXG4gIGFkZF9saW5rX2xpc3RlbmVycyhpdGVtLCBjdXJyLCBsaXN0KSB7XHJcbiAgICBpdGVtLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoZXZlbnQpID0+IHtcclxuICAgICAgYXdhaXQgdGhpcy5vcGVuX25vdGUoY3VyciwgZXZlbnQpO1xyXG4gICAgfSk7XHJcbiAgICAvLyBkcmFnLW9uXHJcbiAgICAvLyBjdXJyZW50bHkgb25seSB3b3JrcyB3aXRoIGZ1bGwtZmlsZSBsaW5rc1xyXG4gICAgaXRlbS5zZXRBdHRyKCdkcmFnZ2FibGUnLCAndHJ1ZScpO1xyXG4gICAgaXRlbS5hZGRFdmVudExpc3RlbmVyKCdkcmFnc3RhcnQnLCAoZXZlbnQpID0+IHtcclxuICAgICAgY29uc3QgZHJhZ01hbmFnZXIgPSB0aGlzLmFwcC5kcmFnTWFuYWdlcjtcclxuICAgICAgY29uc3QgZmlsZV9wYXRoID0gY3Vyci5saW5rLnNwbGl0KFwiI1wiKVswXTtcclxuICAgICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0Rmlyc3RMaW5rcGF0aERlc3QoZmlsZV9wYXRoLCAnJyk7XHJcbiAgICAgIGNvbnN0IGRyYWdEYXRhID0gZHJhZ01hbmFnZXIuZHJhZ0ZpbGUoZXZlbnQsIGZpbGUpO1xyXG4gICAgICAvLyBjb25zb2xlLmxvZyhkcmFnRGF0YSk7XHJcbiAgICAgIGRyYWdNYW5hZ2VyLm9uRHJhZ1N0YXJ0KGV2ZW50LCBkcmFnRGF0YSk7XHJcbiAgICB9KTtcclxuICAgIC8vIGlmIGN1cnIubGluayBjb250YWlucyBjdXJseSBicmFjZXMsIHJldHVybiAoaW5jb21wYXRpYmxlIHdpdGggaG92ZXItbGluaylcclxuICAgIGlmIChjdXJyLmxpbmsuaW5kZXhPZihcIntcIikgPiAtMSkgcmV0dXJuO1xyXG4gICAgLy8gdHJpZ2dlciBob3ZlciBldmVudCBvbiBsaW5rXHJcbiAgICBpdGVtLmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZW92ZXJcIiwgKGV2ZW50KSA9PiB7XHJcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS50cmlnZ2VyKFwiaG92ZXItbGlua1wiLCB7XHJcbiAgICAgICAgZXZlbnQsXHJcbiAgICAgICAgc291cmNlOiBTTUFSVF9DT05ORUNUSU9OU19WSUVXX1RZUEUsXHJcbiAgICAgICAgaG92ZXJQYXJlbnQ6IGxpc3QsXHJcbiAgICAgICAgdGFyZ2V0RWw6IGl0ZW0sXHJcbiAgICAgICAgbGlua3RleHQ6IGN1cnIubGluayxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIC8vIGdldCB0YXJnZXQgZmlsZSBmcm9tIGxpbmsgcGF0aFxyXG4gIC8vIGlmIHN1Yi1zZWN0aW9uIGlzIGxpbmtlZCwgb3BlbiBmaWxlIGFuZCBzY3JvbGwgdG8gc3ViLXNlY3Rpb25cclxuICBhc3luYyBvcGVuX25vdGUoY3VyciwgZXZlbnQ9bnVsbCkge1xyXG4gICAgbGV0IHRhcmdldEZpbGU7XHJcbiAgICBsZXQgaGVhZGluZztcclxuICAgIGlmIChjdXJyLmxpbmsuaW5kZXhPZihcIiNcIikgPiAtMSkge1xyXG4gICAgICAvLyByZW1vdmUgYWZ0ZXIgIyBmcm9tIGxpbmtcclxuICAgICAgdGFyZ2V0RmlsZSA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0Rmlyc3RMaW5rcGF0aERlc3QoY3Vyci5saW5rLnNwbGl0KFwiI1wiKVswXSwgXCJcIik7XHJcbiAgICAgIC8vIGNvbnNvbGUubG9nKHRhcmdldEZpbGUpO1xyXG4gICAgICBjb25zdCB0YXJnZXRfZmlsZV9jYWNoZSA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKHRhcmdldEZpbGUpO1xyXG4gICAgICAvLyBjb25zb2xlLmxvZyh0YXJnZXRfZmlsZV9jYWNoZSk7XHJcbiAgICAgIC8vIGdldCBoZWFkaW5nXHJcbiAgICAgIGxldCBoZWFkaW5nX3RleHQgPSBjdXJyLmxpbmsuc3BsaXQoXCIjXCIpLnBvcCgpO1xyXG4gICAgICAvLyBpZiBoZWFkaW5nIHRleHQgY29udGFpbnMgYSBjdXJseSBicmFjZSwgZ2V0IHRoZSBudW1iZXIgaW5zaWRlIHRoZSBjdXJseSBicmFjZXMgYXMgb2NjdXJlbmNlXHJcbiAgICAgIGxldCBvY2N1cmVuY2UgPSAwO1xyXG4gICAgICBpZiAoaGVhZGluZ190ZXh0LmluZGV4T2YoXCJ7XCIpID4gLTEpIHtcclxuICAgICAgICAvLyBnZXQgb2NjdXJlbmNlXHJcbiAgICAgICAgb2NjdXJlbmNlID0gcGFyc2VJbnQoaGVhZGluZ190ZXh0LnNwbGl0KFwie1wiKVsxXS5zcGxpdChcIn1cIilbMF0pO1xyXG4gICAgICAgIC8vIHJlbW92ZSBvY2N1cmVuY2UgZnJvbSBoZWFkaW5nIHRleHRcclxuICAgICAgICBoZWFkaW5nX3RleHQgPSBoZWFkaW5nX3RleHQuc3BsaXQoXCJ7XCIpWzBdO1xyXG4gICAgICB9XHJcbiAgICAgIC8vIGdldCBoZWFkaW5ncyBmcm9tIGZpbGUgY2FjaGVcclxuICAgICAgY29uc3QgaGVhZGluZ3MgPSB0YXJnZXRfZmlsZV9jYWNoZS5oZWFkaW5ncztcclxuICAgICAgLy8gZ2V0IGhlYWRpbmdzIHdpdGggdGhlIHNhbWUgZGVwdGggYW5kIHRleHQgYXMgdGhlIGxpbmtcclxuICAgICAgZm9yKGxldCBpID0gMDsgaSA8IGhlYWRpbmdzLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgaWYgKGhlYWRpbmdzW2ldLmhlYWRpbmcgPT09IGhlYWRpbmdfdGV4dCkge1xyXG4gICAgICAgICAgLy8gaWYgb2NjdXJlbmNlIGlzIDAsIHNldCBoZWFkaW5nIGFuZCBicmVha1xyXG4gICAgICAgICAgaWYob2NjdXJlbmNlID09PSAwKSB7XHJcbiAgICAgICAgICAgIGhlYWRpbmcgPSBoZWFkaW5nc1tpXTtcclxuICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBvY2N1cmVuY2UtLTsgLy8gZGVjcmVtZW50IG9jY3VyZW5jZVxyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICAvLyBjb25zb2xlLmxvZyhoZWFkaW5nKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIHRhcmdldEZpbGUgPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpcnN0TGlua3BhdGhEZXN0KGN1cnIubGluaywgXCJcIik7XHJcbiAgICB9XHJcbiAgICBsZXQgbGVhZjtcclxuICAgIGlmKGV2ZW50KSB7XHJcbiAgICAgIC8vIHByb3Blcmx5IGhhbmRsZSBpZiB0aGUgbWV0YS9jdHJsIGtleSBpcyBwcmVzc2VkXHJcbiAgICAgIGNvbnN0IG1vZCA9IE9ic2lkaWFuLktleW1hcC5pc01vZEV2ZW50KGV2ZW50KTtcclxuICAgICAgLy8gZ2V0IG1vc3QgcmVjZW50IGxlYWZcclxuICAgICAgbGVhZiA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRMZWFmKG1vZCk7XHJcbiAgICB9ZWxzZXtcclxuICAgICAgLy8gZ2V0IG1vc3QgcmVjZW50IGxlYWZcclxuICAgICAgbGVhZiA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRNb3N0UmVjZW50TGVhZigpO1xyXG4gICAgfVxyXG4gICAgYXdhaXQgbGVhZi5vcGVuRmlsZSh0YXJnZXRGaWxlKTtcclxuICAgIGlmIChoZWFkaW5nKSB7XHJcbiAgICAgIGxldCB7IGVkaXRvciB9ID0gbGVhZi52aWV3O1xyXG4gICAgICBjb25zdCBwb3MgPSB7IGxpbmU6IGhlYWRpbmcucG9zaXRpb24uc3RhcnQubGluZSwgY2g6IDAgfTtcclxuICAgICAgZWRpdG9yLnNldEN1cnNvcihwb3MpO1xyXG4gICAgICBlZGl0b3Iuc2Nyb2xsSW50b1ZpZXcoeyB0bzogcG9zLCBmcm9tOiBwb3MgfSwgdHJ1ZSk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICByZW5kZXJfYmxvY2tfY29udGV4dChibG9jaykge1xyXG4gICAgY29uc3QgYmxvY2tfaGVhZGluZ3MgPSBibG9jay5saW5rLnNwbGl0KFwiLm1kXCIpWzFdLnNwbGl0KFwiI1wiKTtcclxuICAgIC8vIHN0YXJ0aW5nIHdpdGggdGhlIGxhc3QgaGVhZGluZyBmaXJzdCwgaXRlcmF0ZSB0aHJvdWdoIGhlYWRpbmdzXHJcbiAgICBsZXQgYmxvY2tfY29udGV4dCA9IFwiXCI7XHJcbiAgICBmb3IgKGxldCBpID0gYmxvY2tfaGVhZGluZ3MubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcclxuICAgICAgaWYoYmxvY2tfY29udGV4dC5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgYmxvY2tfY29udGV4dCA9IGAgPiAke2Jsb2NrX2NvbnRleHR9YDtcclxuICAgICAgfVxyXG4gICAgICBibG9ja19jb250ZXh0ID0gYmxvY2tfaGVhZGluZ3NbaV0gKyBibG9ja19jb250ZXh0O1xyXG4gICAgICAvLyBpZiBibG9jayBjb250ZXh0IGlzIGxvbmdlciB0aGFuIE4gY2hhcmFjdGVycywgYnJlYWtcclxuICAgICAgaWYgKGJsb2NrX2NvbnRleHQubGVuZ3RoID4gMTAwKSB7XHJcbiAgICAgICAgYnJlYWs7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIC8vIHJlbW92ZSBsZWFkaW5nID4gaWYgZXhpc3RzXHJcbiAgICBpZiAoYmxvY2tfY29udGV4dC5zdGFydHNXaXRoKFwiID4gXCIpKSB7XHJcbiAgICAgIGJsb2NrX2NvbnRleHQgPSBibG9ja19jb250ZXh0LnNsaWNlKDMpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGJsb2NrX2NvbnRleHQ7XHJcblxyXG4gIH1cclxuXHJcbiAgcmVuZGVyYWJsZV9maWxlX3R5cGUobGluaykge1xyXG4gICAgcmV0dXJuIChsaW5rLmluZGV4T2YoXCIubWRcIikgIT09IC0xKSAmJiAobGluay5pbmRleE9mKFwiLmV4Y2FsaWRyYXdcIikgPT09IC0xKTtcclxuICB9XHJcblxyXG4gIHJlbmRlcl9leHRlcm5hbF9saW5rX2VsbShtZXRhKXtcclxuICAgIGlmKG1ldGEuc291cmNlKSB7XHJcbiAgICAgIGlmKG1ldGEuc291cmNlID09PSBcIkdtYWlsXCIpIG1ldGEuc291cmNlID0gXCJcdUQ4M0RcdURDRTcgR21haWxcIjtcclxuICAgICAgcmV0dXJuIGA8c21hbGw+JHttZXRhLnNvdXJjZX08L3NtYWxsPjxicj4ke21ldGEudGl0bGV9YDtcclxuICAgIH1cclxuICAgIC8vIHJlbW92ZSBodHRwKHMpOi8vXHJcbiAgICBsZXQgZG9tYWluID0gbWV0YS5wYXRoLnJlcGxhY2UoLyheXFx3Kzp8XilcXC9cXC8vLCBcIlwiKTtcclxuICAgIC8vIHNlcGFyYXRlIGRvbWFpbiBmcm9tIHBhdGhcclxuICAgIGRvbWFpbiA9IGRvbWFpbi5zcGxpdChcIi9cIilbMF07XHJcbiAgICAvLyB3cmFwIGRvbWFpbiBpbiA8c21hbGw+IGFuZCBhZGQgbGluZSBicmVha1xyXG4gICAgcmV0dXJuIGA8c21hbGw+XHVEODNDXHVERjEwICR7ZG9tYWlufTwvc21hbGw+PGJyPiR7bWV0YS50aXRsZX1gO1xyXG4gIH1cclxuICAvLyBnZXQgYWxsIGZvbGRlcnNcclxuICBhc3luYyBnZXRfYWxsX2ZvbGRlcnMoKSB7XHJcbiAgICBpZighdGhpcy5mb2xkZXJzIHx8IHRoaXMuZm9sZGVycy5sZW5ndGggPT09IDApe1xyXG4gICAgICB0aGlzLmZvbGRlcnMgPSBhd2FpdCB0aGlzLmdldF9mb2xkZXJzKCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gdGhpcy5mb2xkZXJzO1xyXG4gIH1cclxuICAvLyBnZXQgZm9sZGVycywgdHJhdmVyc2Ugbm9uLWhpZGRlbiBzdWItZm9sZGVyc1xyXG4gIGFzeW5jIGdldF9mb2xkZXJzKHBhdGggPSBcIi9cIikge1xyXG4gICAgbGV0IGZvbGRlcnMgPSAoYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci5saXN0KHBhdGgpKS5mb2xkZXJzO1xyXG4gICAgbGV0IGZvbGRlcl9saXN0ID0gW107XHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGZvbGRlcnMubGVuZ3RoOyBpKyspIHtcclxuICAgICAgaWYgKGZvbGRlcnNbaV0uc3RhcnRzV2l0aChcIi5cIikpIGNvbnRpbnVlO1xyXG4gICAgICBmb2xkZXJfbGlzdC5wdXNoKGZvbGRlcnNbaV0pO1xyXG4gICAgICBmb2xkZXJfbGlzdCA9IGZvbGRlcl9saXN0LmNvbmNhdChhd2FpdCB0aGlzLmdldF9mb2xkZXJzKGZvbGRlcnNbaV0gKyBcIi9cIikpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGZvbGRlcl9saXN0O1xyXG4gIH1cclxuXHJcblxyXG4gIGFzeW5jIHN5bmNfbm90ZXMoKSB7XHJcbiAgICAvLyBpZiBsaWNlbnNlIGtleSBpcyBub3Qgc2V0LCByZXR1cm5cclxuICAgIGlmKCF0aGlzLnNldHRpbmdzLmxpY2Vuc2Vfa2V5KXtcclxuICAgICAgbmV3IE9ic2lkaWFuLk5vdGljZShcIlNtYXJ0IENvbm5lY3Rpb25zOiBTdXBwb3J0ZXIgbGljZW5zZSBrZXkgaXMgcmVxdWlyZWQgdG8gc3luYyBub3RlcyB0byB0aGUgQ2hhdEdQVCBQbHVnaW4gc2VydmVyLlwiKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgY29uc29sZS5sb2coXCJzeW5jaW5nIG5vdGVzXCIpO1xyXG4gICAgLy8gZ2V0IGFsbCBmaWxlcyBpbiB2YXVsdFxyXG4gICAgY29uc3QgZmlsZXMgPSB0aGlzLmFwcC52YXVsdC5nZXRNYXJrZG93bkZpbGVzKCkuZmlsdGVyKChmaWxlKSA9PiB7XHJcbiAgICAgIC8vIGZpbHRlciBvdXQgZmlsZSBwYXRocyBtYXRjaGluZyBhbnkgc3RyaW5ncyBpbiB0aGlzLmZpbGVfZXhjbHVzaW9uc1xyXG4gICAgICBmb3IobGV0IGkgPSAwOyBpIDwgdGhpcy5maWxlX2V4Y2x1c2lvbnMubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICBpZihmaWxlLnBhdGguaW5kZXhPZih0aGlzLmZpbGVfZXhjbHVzaW9uc1tpXSkgPiAtMSkge1xyXG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICByZXR1cm4gdHJ1ZTtcclxuICAgIH0pO1xyXG4gICAgY29uc3Qgbm90ZXMgPSBhd2FpdCB0aGlzLmJ1aWxkX25vdGVzX29iamVjdChmaWxlcyk7XHJcbiAgICBjb25zb2xlLmxvZyhcIm9iamVjdCBidWlsdFwiKTtcclxuICAgIC8vIHNhdmUgbm90ZXMgb2JqZWN0IHRvIC5zbWFydC1jb25uZWN0aW9ucy9ub3Rlcy5qc29uXHJcbiAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLndyaXRlKFwiLnNtYXJ0LWNvbm5lY3Rpb25zL25vdGVzLmpzb25cIiwgSlNPTi5zdHJpbmdpZnkobm90ZXMsIG51bGwsIDIpKTtcclxuICAgIGNvbnNvbGUubG9nKFwibm90ZXMgc2F2ZWRcIik7XHJcbiAgICBjb25zb2xlLmxvZyh0aGlzLnNldHRpbmdzLmxpY2Vuc2Vfa2V5KTtcclxuICAgIC8vIFBPU1Qgbm90ZXMgb2JqZWN0IHRvIHNlcnZlclxyXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCAoMCwgT2JzaWRpYW4ucmVxdWVzdFVybCkoe1xyXG4gICAgICB1cmw6IFwiaHR0cHM6Ly9zeW5jLnNtYXJ0Y29ubmVjdGlvbnMuYXBwL3N5bmNcIixcclxuICAgICAgbWV0aG9kOiBcIlBPU1RcIixcclxuICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxyXG4gICAgICB9LFxyXG4gICAgICBjb250ZW50VHlwZTogXCJhcHBsaWNhdGlvbi9qc29uXCIsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICBsaWNlbnNlX2tleTogdGhpcy5zZXR0aW5ncy5saWNlbnNlX2tleSxcclxuICAgICAgICBub3Rlczogbm90ZXNcclxuICAgICAgfSlcclxuICAgIH0pO1xyXG4gICAgY29uc29sZS5sb2cocmVzcG9uc2UpO1xyXG5cclxuICB9XHJcblxyXG4gIGFzeW5jIGJ1aWxkX25vdGVzX29iamVjdChmaWxlcykge1xyXG4gICAgbGV0IG91dHB1dCA9IHt9O1xyXG4gIFxyXG4gICAgZm9yKGxldCBpID0gMDsgaSA8IGZpbGVzLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgIGxldCBmaWxlID0gZmlsZXNbaV07XHJcbiAgICAgIGxldCBwYXJ0cyA9IGZpbGUucGF0aC5zcGxpdChcIi9cIik7XHJcbiAgICAgIGxldCBjdXJyZW50ID0gb3V0cHV0O1xyXG4gIFxyXG4gICAgICBmb3IgKGxldCBpaSA9IDA7IGlpIDwgcGFydHMubGVuZ3RoOyBpaSsrKSB7XHJcbiAgICAgICAgbGV0IHBhcnQgPSBwYXJ0c1tpaV07XHJcbiAgXHJcbiAgICAgICAgaWYgKGlpID09PSBwYXJ0cy5sZW5ndGggLSAxKSB7XHJcbiAgICAgICAgICAvLyBUaGlzIGlzIGEgZmlsZVxyXG4gICAgICAgICAgY3VycmVudFtwYXJ0XSA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQoZmlsZSk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIC8vIFRoaXMgaXMgYSBkaXJlY3RvcnlcclxuICAgICAgICAgIGlmICghY3VycmVudFtwYXJ0XSkge1xyXG4gICAgICAgICAgICBjdXJyZW50W3BhcnRdID0ge307XHJcbiAgICAgICAgICB9XHJcbiAgXHJcbiAgICAgICAgICBjdXJyZW50ID0gY3VycmVudFtwYXJ0XTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH1cclxuICBcclxuICAgIHJldHVybiBvdXRwdXQ7XHJcbiAgfVxyXG5cclxufVxyXG5cclxuY29uc3QgU01BUlRfQ09OTkVDVElPTlNfVklFV19UWVBFID0gXCJzbWFydC1jb25uZWN0aW9ucy12aWV3XCI7XHJcbmNsYXNzIFNtYXJ0Q29ubmVjdGlvbnNWaWV3IGV4dGVuZHMgT2JzaWRpYW4uSXRlbVZpZXcge1xyXG4gIGNvbnN0cnVjdG9yKGxlYWYsIHBsdWdpbikge1xyXG4gICAgc3VwZXIobGVhZik7XHJcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcclxuICAgIHRoaXMubmVhcmVzdCA9IG51bGw7XHJcbiAgICB0aGlzLmxvYWRfd2FpdCA9IG51bGw7XHJcbiAgfVxyXG4gIGdldFZpZXdUeXBlKCkge1xyXG4gICAgcmV0dXJuIFNNQVJUX0NPTk5FQ1RJT05TX1ZJRVdfVFlQRTtcclxuICB9XHJcblxyXG4gIGdldERpc3BsYXlUZXh0KCkge1xyXG4gICAgcmV0dXJuIFwiU21hcnQgQ29ubmVjdGlvbnMgRmlsZXNcIjtcclxuICB9XHJcblxyXG4gIGdldEljb24oKSB7XHJcbiAgICByZXR1cm4gXCJzbWFydC1jb25uZWN0aW9uc1wiO1xyXG4gIH1cclxuXHJcblxyXG4gIHNldF9tZXNzYWdlKG1lc3NhZ2UpIHtcclxuICAgIGNvbnN0IGNvbnRhaW5lciA9IHRoaXMuY29udGFpbmVyRWwuY2hpbGRyZW5bMV07XHJcbiAgICAvLyBjbGVhciBjb250YWluZXJcclxuICAgIGNvbnRhaW5lci5lbXB0eSgpO1xyXG4gICAgLy8gaW5pdGlhdGUgdG9wIGJhclxyXG4gICAgdGhpcy5pbml0aWF0ZV90b3BfYmFyKGNvbnRhaW5lcik7XHJcbiAgICAvLyBpZiBtZXNhZ2UgaXMgYW4gYXJyYXksIGxvb3AgdGhyb3VnaCBhbmQgY3JlYXRlIGEgbmV3IHAgZWxlbWVudCBmb3IgZWFjaCBtZXNzYWdlXHJcbiAgICBpZiAoQXJyYXkuaXNBcnJheShtZXNzYWdlKSkge1xyXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IG1lc3NhZ2UubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICBjb250YWluZXIuY3JlYXRlRWwoXCJwXCIsIHsgY2xzOiBcInNjX21lc3NhZ2VcIiwgdGV4dDogbWVzc2FnZVtpXSB9KTtcclxuICAgICAgfVxyXG4gICAgfWVsc2V7XHJcbiAgICAgIC8vIGNyZWF0ZSBwIGVsZW1lbnQgd2l0aCBtZXNzYWdlXHJcbiAgICAgIGNvbnRhaW5lci5jcmVhdGVFbChcInBcIiwgeyBjbHM6IFwic2NfbWVzc2FnZVwiLCB0ZXh0OiBtZXNzYWdlIH0pO1xyXG4gICAgfVxyXG4gIH1cclxuICByZW5kZXJfbGlua190ZXh0KGxpbmssIHNob3dfZnVsbF9wYXRoPWZhbHNlKSB7XHJcbiAgICAvKipcclxuICAgICAqIEJlZ2luIGludGVybmFsIGxpbmtzXHJcbiAgICAgKi9cclxuICAgIC8vIGlmIHNob3cgZnVsbCBwYXRoIGlzIGZhbHNlLCByZW1vdmUgZmlsZSBwYXRoXHJcbiAgICBpZiAoIXNob3dfZnVsbF9wYXRoKSB7XHJcbiAgICAgIGxpbmsgPSBsaW5rLnNwbGl0KFwiL1wiKS5wb3AoKTtcclxuICAgIH1cclxuICAgIC8vIGlmIGNvbnRhaW5zICcjJ1xyXG4gICAgaWYgKGxpbmsuaW5kZXhPZihcIiNcIikgPiAtMSkge1xyXG4gICAgICAvLyBzcGxpdCBhdCAubWRcclxuICAgICAgbGluayA9IGxpbmsuc3BsaXQoXCIubWRcIik7XHJcbiAgICAgIC8vIHdyYXAgZmlyc3QgcGFydCBpbiA8c21hbGw+IGFuZCBhZGQgbGluZSBicmVha1xyXG4gICAgICBsaW5rWzBdID0gYDxzbWFsbD4ke2xpbmtbMF19PC9zbWFsbD48YnI+YDtcclxuICAgICAgLy8gam9pbiBiYWNrIHRvZ2V0aGVyXHJcbiAgICAgIGxpbmsgPSBsaW5rLmpvaW4oXCJcIik7XHJcbiAgICAgIC8vIHJlcGxhY2UgJyMnIHdpdGggJyBcdTAwQkIgJ1xyXG4gICAgICBsaW5rID0gbGluay5yZXBsYWNlKC9cXCMvZywgXCIgXHUwMEJCIFwiKTtcclxuICAgIH1lbHNle1xyXG4gICAgICAvLyByZW1vdmUgJy5tZCdcclxuICAgICAgbGluayA9IGxpbmsucmVwbGFjZShcIi5tZFwiLCBcIlwiKTtcclxuICAgIH1cclxuICAgIHJldHVybiBsaW5rO1xyXG4gIH1cclxuXHJcblxyXG4gIHNldF9uZWFyZXN0KG5lYXJlc3QsIG5lYXJlc3RfY29udGV4dD1udWxsLCByZXN1bHRzX29ubHk9ZmFsc2UpIHtcclxuICAgIC8vIGdldCBjb250YWluZXIgZWxlbWVudFxyXG4gICAgY29uc3QgY29udGFpbmVyID0gdGhpcy5jb250YWluZXJFbC5jaGlsZHJlblsxXTtcclxuICAgIC8vIGlmIHJlc3VsdHMgb25seSBpcyBmYWxzZSwgY2xlYXIgY29udGFpbmVyIGFuZCBpbml0aWF0ZSB0b3AgYmFyXHJcbiAgICBpZighcmVzdWx0c19vbmx5KXtcclxuICAgICAgLy8gY2xlYXIgY29udGFpbmVyXHJcbiAgICAgIGNvbnRhaW5lci5lbXB0eSgpO1xyXG4gICAgICB0aGlzLmluaXRpYXRlX3RvcF9iYXIoY29udGFpbmVyLCBuZWFyZXN0X2NvbnRleHQpO1xyXG4gICAgfVxyXG4gICAgLy8gdXBkYXRlIHJlc3VsdHNcclxuICAgIHRoaXMucGx1Z2luLnVwZGF0ZV9yZXN1bHRzKGNvbnRhaW5lciwgbmVhcmVzdCk7XHJcbiAgfVxyXG5cclxuICBpbml0aWF0ZV90b3BfYmFyKGNvbnRhaW5lciwgbmVhcmVzdF9jb250ZXh0PW51bGwpIHtcclxuICAgIGxldCB0b3BfYmFyO1xyXG4gICAgLy8gaWYgdG9wIGJhciBhbHJlYWR5IGV4aXN0cywgZW1wdHkgaXRcclxuICAgIGlmICgoY29udGFpbmVyLmNoaWxkcmVuLmxlbmd0aCA+IDApICYmIChjb250YWluZXIuY2hpbGRyZW5bMF0uY2xhc3NMaXN0LmNvbnRhaW5zKFwic2MtdG9wLWJhclwiKSkpIHtcclxuICAgICAgdG9wX2JhciA9IGNvbnRhaW5lci5jaGlsZHJlblswXTtcclxuICAgICAgdG9wX2Jhci5lbXB0eSgpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgLy8gaW5pdCBjb250YWluZXIgZm9yIHRvcCBiYXJcclxuICAgICAgdG9wX2JhciA9IGNvbnRhaW5lci5jcmVhdGVFbChcImRpdlwiLCB7IGNsczogXCJzYy10b3AtYmFyXCIgfSk7XHJcbiAgICB9XHJcbiAgICAvLyBpZiBoaWdobGlnaHRlZCB0ZXh0IGlzIG5vdCBudWxsLCBjcmVhdGUgcCBlbGVtZW50IHdpdGggaGlnaGxpZ2h0ZWQgdGV4dFxyXG4gICAgaWYgKG5lYXJlc3RfY29udGV4dCkge1xyXG4gICAgICB0b3BfYmFyLmNyZWF0ZUVsKFwicFwiLCB7IGNsczogXCJzYy1jb250ZXh0XCIsIHRleHQ6IG5lYXJlc3RfY29udGV4dCB9KTtcclxuICAgIH1cclxuICAgIC8vIGFkZCBjaGF0IGJ1dHRvblxyXG4gICAgY29uc3QgY2hhdF9idXR0b24gPSB0b3BfYmFyLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgY2xzOiBcInNjLWNoYXQtYnV0dG9uXCIgfSk7XHJcbiAgICAvLyBhZGQgaWNvbiB0byBjaGF0IGJ1dHRvblxyXG4gICAgT2JzaWRpYW4uc2V0SWNvbihjaGF0X2J1dHRvbiwgXCJtZXNzYWdlLXNxdWFyZVwiKTtcclxuICAgIC8vIGFkZCBjbGljayBsaXN0ZW5lciB0byBjaGF0IGJ1dHRvblxyXG4gICAgY2hhdF9idXR0b24uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcclxuICAgICAgLy8gb3BlbiBjaGF0XHJcbiAgICAgIHRoaXMucGx1Z2luLm9wZW5fY2hhdCgpO1xyXG4gICAgfSk7XHJcbiAgICAvLyBhZGQgc2VhcmNoIGJ1dHRvblxyXG4gICAgY29uc3Qgc2VhcmNoX2J1dHRvbiA9IHRvcF9iYXIuY3JlYXRlRWwoXCJidXR0b25cIiwgeyBjbHM6IFwic2Mtc2VhcmNoLWJ1dHRvblwiIH0pO1xyXG4gICAgLy8gYWRkIGljb24gdG8gc2VhcmNoIGJ1dHRvblxyXG4gICAgT2JzaWRpYW4uc2V0SWNvbihzZWFyY2hfYnV0dG9uLCBcInNlYXJjaFwiKTtcclxuICAgIC8vIGFkZCBjbGljayBsaXN0ZW5lciB0byBzZWFyY2ggYnV0dG9uXHJcbiAgICBzZWFyY2hfYnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XHJcbiAgICAgIC8vIGVtcHR5IHRvcCBiYXJcclxuICAgICAgdG9wX2Jhci5lbXB0eSgpO1xyXG4gICAgICAvLyBjcmVhdGUgaW5wdXQgZWxlbWVudFxyXG4gICAgICBjb25zdCBzZWFyY2hfY29udGFpbmVyID0gdG9wX2Jhci5jcmVhdGVFbChcImRpdlwiLCB7IGNsczogXCJzZWFyY2gtaW5wdXQtY29udGFpbmVyXCIgfSk7XHJcbiAgICAgIGNvbnN0IGlucHV0ID0gc2VhcmNoX2NvbnRhaW5lci5jcmVhdGVFbChcImlucHV0XCIsIHtcclxuICAgICAgICBjbHM6IFwic2Mtc2VhcmNoLWlucHV0XCIsXHJcbiAgICAgICAgdHlwZTogXCJzZWFyY2hcIixcclxuICAgICAgICBwbGFjZWhvbGRlcjogXCJUeXBlIHRvIHN0YXJ0IHNlYXJjaC4uLlwiLCBcclxuICAgICAgfSk7XHJcbiAgICAgIC8vIGZvY3VzIGlucHV0XHJcbiAgICAgIGlucHV0LmZvY3VzKCk7XHJcbiAgICAgIC8vIGFkZCBrZXlkb3duIGxpc3RlbmVyIHRvIGlucHV0XHJcbiAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIChldmVudCkgPT4ge1xyXG4gICAgICAgIC8vIGlmIGVzY2FwZSBrZXkgaXMgcHJlc3NlZFxyXG4gICAgICAgIGlmIChldmVudC5rZXkgPT09IFwiRXNjYXBlXCIpIHtcclxuICAgICAgICAgIHRoaXMuY2xlYXJfYXV0b19zZWFyY2hlcigpO1xyXG4gICAgICAgICAgLy8gY2xlYXIgdG9wIGJhclxyXG4gICAgICAgICAgdGhpcy5pbml0aWF0ZV90b3BfYmFyKGNvbnRhaW5lciwgbmVhcmVzdF9jb250ZXh0KTtcclxuICAgICAgICB9XHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgLy8gYWRkIGtleXVwIGxpc3RlbmVyIHRvIGlucHV0XHJcbiAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJrZXl1cFwiLCAoZXZlbnQpID0+IHtcclxuICAgICAgICAvLyBpZiB0aGlzLnNlYXJjaF90aW1lb3V0IGlzIG5vdCBudWxsIHRoZW4gY2xlYXIgaXQgYW5kIHNldCB0byBudWxsXHJcbiAgICAgICAgdGhpcy5jbGVhcl9hdXRvX3NlYXJjaGVyKCk7XHJcbiAgICAgICAgLy8gZ2V0IHNlYXJjaCB0ZXJtXHJcbiAgICAgICAgY29uc3Qgc2VhcmNoX3Rlcm0gPSBpbnB1dC52YWx1ZTtcclxuICAgICAgICAvLyBpZiBlbnRlciBrZXkgaXMgcHJlc3NlZFxyXG4gICAgICAgIGlmIChldmVudC5rZXkgPT09IFwiRW50ZXJcIiAmJiBzZWFyY2hfdGVybSAhPT0gXCJcIikge1xyXG4gICAgICAgICAgdGhpcy5zZWFyY2goc2VhcmNoX3Rlcm0pO1xyXG4gICAgICAgIH1cclxuICAgICAgICAvLyBpZiBhbnkgb3RoZXIga2V5IGlzIHByZXNzZWQgYW5kIGlucHV0IGlzIG5vdCBlbXB0eSB0aGVuIHdhaXQgNTAwbXMgYW5kIG1ha2VfY29ubmVjdGlvbnNcclxuICAgICAgICBlbHNlIGlmIChzZWFyY2hfdGVybSAhPT0gXCJcIikge1xyXG4gICAgICAgICAgLy8gY2xlYXIgdGltZW91dFxyXG4gICAgICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuc2VhcmNoX3RpbWVvdXQpO1xyXG4gICAgICAgICAgLy8gc2V0IHRpbWVvdXRcclxuICAgICAgICAgIHRoaXMuc2VhcmNoX3RpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICAgICAgdGhpcy5zZWFyY2goc2VhcmNoX3Rlcm0sIHRydWUpO1xyXG4gICAgICAgICAgfSwgNzAwKTtcclxuICAgICAgICB9XHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICAvLyByZW5kZXIgYnV0dG9uczogXCJjcmVhdGVcIiBhbmQgXCJyZXRyeVwiIGZvciBsb2FkaW5nIGVtYmVkZGluZ3MuanNvbiBmaWxlXHJcbiAgcmVuZGVyX2VtYmVkZGluZ3NfYnV0dG9ucygpIHtcclxuICAgIC8vIGdldCBjb250YWluZXIgZWxlbWVudFxyXG4gICAgY29uc3QgY29udGFpbmVyID0gdGhpcy5jb250YWluZXJFbC5jaGlsZHJlblsxXTtcclxuICAgIC8vIGNsZWFyIGNvbnRhaW5lclxyXG4gICAgY29udGFpbmVyLmVtcHR5KCk7XHJcbiAgICAvLyBjcmVhdGUgaGVhZGluZyB0aGF0IHNheXMgXCJFbWJlZGRpbmdzIGZpbGUgbm90IGZvdW5kXCJcclxuICAgIGNvbnRhaW5lci5jcmVhdGVFbChcImgyXCIsIHsgY2xzOiBcInNjSGVhZGluZ1wiLCB0ZXh0OiBcIkVtYmVkZGluZ3MgZmlsZSBub3QgZm91bmRcIiB9KTtcclxuICAgIC8vIGNyZWF0ZSBkaXYgZm9yIGJ1dHRvbnNcclxuICAgIGNvbnN0IGJ1dHRvbl9kaXYgPSBjb250YWluZXIuY3JlYXRlRWwoXCJkaXZcIiwgeyBjbHM6IFwic2NCdXR0b25EaXZcIiB9KTtcclxuICAgIC8vIGNyZWF0ZSBcImNyZWF0ZVwiIGJ1dHRvblxyXG4gICAgY29uc3QgY3JlYXRlX2J1dHRvbiA9IGJ1dHRvbl9kaXYuY3JlYXRlRWwoXCJidXR0b25cIiwgeyBjbHM6IFwic2NCdXR0b25cIiwgdGV4dDogXCJDcmVhdGUgZW1iZWRkaW5ncy5qc29uXCIgfSk7XHJcbiAgICAvLyBub3RlIHRoYXQgY3JlYXRpbmcgZW1iZWRkaW5ncy5qc29uIGZpbGUgd2lsbCB0cmlnZ2VyIGJ1bGsgZW1iZWRkaW5nIGFuZCBtYXkgdGFrZSBhIHdoaWxlXHJcbiAgICBidXR0b25fZGl2LmNyZWF0ZUVsKFwicFwiLCB7IGNsczogXCJzY0J1dHRvbk5vdGVcIiwgdGV4dDogXCJXYXJuaW5nOiBDcmVhdGluZyBlbWJlZGRpbmdzLmpzb24gZmlsZSB3aWxsIHRyaWdnZXIgYnVsayBlbWJlZGRpbmcgYW5kIG1heSB0YWtlIGEgd2hpbGVcIiB9KTtcclxuICAgIC8vIGNyZWF0ZSBcInJldHJ5XCIgYnV0dG9uXHJcbiAgICBjb25zdCByZXRyeV9idXR0b24gPSBidXR0b25fZGl2LmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgY2xzOiBcInNjQnV0dG9uXCIsIHRleHQ6IFwiUmV0cnlcIiB9KTtcclxuICAgIC8vIHRyeSB0byBsb2FkIGVtYmVkZGluZ3MuanNvbiBmaWxlIGFnYWluXHJcbiAgICBidXR0b25fZGl2LmNyZWF0ZUVsKFwicFwiLCB7IGNsczogXCJzY0J1dHRvbk5vdGVcIiwgdGV4dDogXCJJZiBlbWJlZGRpbmdzLmpzb24gZmlsZSBhbHJlYWR5IGV4aXN0cywgY2xpY2sgJ1JldHJ5JyB0byBsb2FkIGl0XCIgfSk7XHJcblxyXG4gICAgLy8gYWRkIGNsaWNrIGV2ZW50IHRvIFwiY3JlYXRlXCIgYnV0dG9uXHJcbiAgICBjcmVhdGVfYnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoZXZlbnQpID0+IHtcclxuICAgICAgLy8gY3JlYXRlIGVtYmVkZGluZ3MuanNvbiBmaWxlXHJcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNtYXJ0X3ZlY19saXRlLmluaXRfZW1iZWRkaW5nc19maWxlKCk7XHJcbiAgICAgIC8vIHJlbG9hZCB2aWV3XHJcbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyX2Nvbm5lY3Rpb25zKCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBhZGQgY2xpY2sgZXZlbnQgdG8gXCJyZXRyeVwiIGJ1dHRvblxyXG4gICAgcmV0cnlfYnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoZXZlbnQpID0+IHtcclxuICAgICAgY29uc29sZS5sb2coXCJyZXRyeWluZyB0byBsb2FkIGVtYmVkZGluZ3MuanNvbiBmaWxlXCIpO1xyXG4gICAgICAvLyByZWxvYWQgZW1iZWRkaW5ncy5qc29uIGZpbGVcclxuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uaW5pdF92ZWNzKCk7XHJcbiAgICAgIC8vIHJlbG9hZCB2aWV3XHJcbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyX2Nvbm5lY3Rpb25zKCk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIGFzeW5jIG9uT3BlbigpIHtcclxuICAgIGNvbnN0IGNvbnRhaW5lciA9IHRoaXMuY29udGFpbmVyRWwuY2hpbGRyZW5bMV07XHJcbiAgICBjb250YWluZXIuZW1wdHkoKTtcclxuICAgIC8vIHBsYWNlaG9sZGVyIHRleHRcclxuICAgIGNvbnRhaW5lci5jcmVhdGVFbChcInBcIiwgeyBjbHM6IFwic2NQbGFjZWhvbGRlclwiLCB0ZXh0OiBcIk9wZW4gYSBub3RlIHRvIGZpbmQgY29ubmVjdGlvbnMuXCIgfSk7IFxyXG5cclxuICAgIC8vIHJ1bnMgd2hlbiBmaWxlIGlzIG9wZW5lZFxyXG4gICAgdGhpcy5wbHVnaW4ucmVnaXN0ZXJFdmVudCh0aGlzLmFwcC53b3Jrc3BhY2Uub24oJ2ZpbGUtb3BlbicsIChmaWxlKSA9PiB7XHJcbiAgICAgIC8vIGlmIG5vIGZpbGUgaXMgb3BlbiwgcmV0dXJuXHJcbiAgICAgIGlmKCFmaWxlKSB7XHJcbiAgICAgICAgLy8gY29uc29sZS5sb2coXCJubyBmaWxlIG9wZW4sIHJldHVybmluZ1wiKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuICAgICAgLy8gcmV0dXJuIGlmIGZpbGUgdHlwZSBpcyBub3Qgc3VwcG9ydGVkXHJcbiAgICAgIGlmKFNVUFBPUlRFRF9GSUxFX1RZUEVTLmluZGV4T2YoZmlsZS5leHRlbnNpb24pID09PSAtMSkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLnNldF9tZXNzYWdlKFtcclxuICAgICAgICAgIFwiRmlsZTogXCIrZmlsZS5uYW1lXHJcbiAgICAgICAgICAsXCJVbnN1cHBvcnRlZCBmaWxlIHR5cGUgKFN1cHBvcnRlZDogXCIrU1VQUE9SVEVEX0ZJTEVfVFlQRVMuam9pbihcIiwgXCIpK1wiKVwiXHJcbiAgICAgICAgXSk7XHJcbiAgICAgIH1cclxuICAgICAgLy8gcnVuIHJlbmRlcl9jb25uZWN0aW9ucyBhZnRlciAxIHNlY29uZCB0byBhbGxvdyBmb3IgZmlsZSB0byBsb2FkXHJcbiAgICAgIGlmKHRoaXMubG9hZF93YWl0KXtcclxuICAgICAgICBjbGVhclRpbWVvdXQodGhpcy5sb2FkX3dhaXQpO1xyXG4gICAgICB9XHJcbiAgICAgIHRoaXMubG9hZF93YWl0ID0gc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgICAgdGhpcy5yZW5kZXJfY29ubmVjdGlvbnMoZmlsZSk7XHJcbiAgICAgICAgdGhpcy5sb2FkX3dhaXQgPSBudWxsO1xyXG4gICAgICB9LCAxMDAwKTtcclxuICAgICAgICBcclxuICAgIH0pKTtcclxuXHJcbiAgICB0aGlzLmFwcC53b3Jrc3BhY2UucmVnaXN0ZXJIb3ZlckxpbmtTb3VyY2UoU01BUlRfQ09OTkVDVElPTlNfVklFV19UWVBFLCB7XHJcbiAgICAgICAgZGlzcGxheTogJ1NtYXJ0IENvbm5lY3Rpb25zIEZpbGVzJyxcclxuICAgICAgICBkZWZhdWx0TW9kOiB0cnVlLFxyXG4gICAgfSk7XHJcbiAgICB0aGlzLmFwcC53b3Jrc3BhY2UucmVnaXN0ZXJIb3ZlckxpbmtTb3VyY2UoU01BUlRfQ09OTkVDVElPTlNfQ0hBVF9WSUVXX1RZUEUsIHtcclxuICAgICAgICBkaXNwbGF5OiAnU21hcnQgQ2hhdCBMaW5rcycsXHJcbiAgICAgICAgZGVmYXVsdE1vZDogdHJ1ZSxcclxuICAgIH0pO1xyXG5cclxuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KHRoaXMuaW5pdGlhbGl6ZS5iaW5kKHRoaXMpKTtcclxuICAgIFxyXG4gIH1cclxuICBcclxuICBhc3luYyBpbml0aWFsaXplKCkge1xyXG4gICAgdGhpcy5zZXRfbWVzc2FnZShcIlx1NkI2M1x1NTcyOFx1NTJBMFx1OEY3RFx1NUQ0Q1x1NTE2NVx1NjU4N1x1NEVGNi4uLlwiKTtcclxuICAgIGNvbnN0IHZlY3NfaW50aWF0ZWQgPSBhd2FpdCB0aGlzLnBsdWdpbi5pbml0X3ZlY3MoKTtcclxuICAgIGlmKHZlY3NfaW50aWF0ZWQpe1xyXG4gICAgICB0aGlzLnNldF9tZXNzYWdlKFwiXHU1RDRDXHU1MTY1XHU2NTg3XHU0RUY2XHU1MkEwXHU4RjdEXHU1QjhDXHU2MjEwXCIpO1xyXG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcl9jb25uZWN0aW9ucygpO1xyXG4gICAgfWVsc2V7XHJcbiAgICAgIHRoaXMucmVuZGVyX2VtYmVkZGluZ3NfYnV0dG9ucygpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogRVhQRVJJTUVOVEFMXHJcbiAgICAgKiAtIHdpbmRvdy1iYXNlZCBBUEkgYWNjZXNzXHJcbiAgICAgKiAtIGNvZGUtYmxvY2sgcmVuZGVyaW5nXHJcbiAgICAgKi9cclxuICAgIHRoaXMuYXBpID0gbmV3IFNtYXJ0Q29ubmVjdGlvbnNWaWV3QXBpKHRoaXMuYXBwLCB0aGlzLnBsdWdpbiwgdGhpcyk7XHJcbiAgICAvLyByZWdpc3RlciBBUEkgdG8gZ2xvYmFsIHdpbmRvdyBvYmplY3RcclxuICAgICh3aW5kb3dbXCJTbWFydENvbm5lY3Rpb25zVmlld0FwaVwiXSA9IHRoaXMuYXBpKSAmJiB0aGlzLnJlZ2lzdGVyKCgpID0+IGRlbGV0ZSB3aW5kb3dbXCJTbWFydENvbm5lY3Rpb25zVmlld0FwaVwiXSk7XHJcblxyXG4gIH1cclxuXHJcbiAgYXN5bmMgb25DbG9zZSgpIHtcclxuICAgIGNvbnNvbGUubG9nKFwiY2xvc2luZyBzbWFydCBjb25uZWN0aW9ucyB2aWV3XCIpO1xyXG4gICAgdGhpcy5hcHAud29ya3NwYWNlLnVucmVnaXN0ZXJIb3ZlckxpbmtTb3VyY2UoU01BUlRfQ09OTkVDVElPTlNfVklFV19UWVBFKTtcclxuICAgIHRoaXMucGx1Z2luLnZpZXcgPSBudWxsO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgcmVuZGVyX2Nvbm5lY3Rpb25zKGNvbnRleHQ9bnVsbCkge1xyXG4gICAgY29uc29sZS5sb2coXCJyZW5kZXJpbmcgY29ubmVjdGlvbnNcIik7XHJcbiAgICAvLyBpZiBBUEkga2V5IGlzIG5vdCBzZXQgdGhlbiB1cGRhdGUgdmlldyBtZXNzYWdlXHJcbiAgICBpZighdGhpcy5wbHVnaW4uc2V0dGluZ3MuYXBpX2tleSkge1xyXG4gICAgICB0aGlzLnNldF9tZXNzYWdlKFwiXHU2QjYzXHU3ODZFXHU5MTREXHU3RjZFIE9wZW5BSSBBUEkgXHU0RkUxXHU2MDZGXHU1NDBFXHU2NUI5XHU1M0VGXHU0RjdGXHU3NTI4IFNtYXJ0IENvbm5lY3Rpb25zXCIpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBpZighdGhpcy5wbHVnaW4uZW1iZWRkaW5nc19sb2FkZWQpe1xyXG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5pbml0X3ZlY3MoKTtcclxuICAgIH1cclxuICAgIC8vIGlmIGVtYmVkZGluZyBzdGlsbCBub3QgbG9hZGVkLCByZXR1cm5cclxuICAgIGlmKCF0aGlzLnBsdWdpbi5lbWJlZGRpbmdzX2xvYWRlZCkge1xyXG4gICAgICBjb25zb2xlLmxvZyhcIlx1NUQ0Q1x1NTE2NVx1NjU4N1x1NEVGNlx1NUMxQVx1NjcyQVx1NTJBMFx1OEY3RFx1NjIxNlx1NUMxQVx1NjcyQVx1NTIxQlx1NUVGQVwiKTtcclxuICAgICAgdGhpcy5yZW5kZXJfZW1iZWRkaW5nc19idXR0b25zKCk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIHRoaXMuc2V0X21lc3NhZ2UoXCJcdTZCNjNcdTU3MjhcdTUyMUJcdTVFRkFcdTY2N0FcdTgwRkRcdThGREVcdTYzQTUuLi5cIik7XHJcbiAgICAvKipcclxuICAgICAqIEJlZ2luIGhpZ2hsaWdodGVkLXRleHQtbGV2ZWwgc2VhcmNoXHJcbiAgICAgKi9cclxuICAgIGlmKHR5cGVvZiBjb250ZXh0ID09PSBcInN0cmluZ1wiKSB7XHJcbiAgICAgIGNvbnN0IGhpZ2hsaWdodGVkX3RleHQgPSBjb250ZXh0O1xyXG4gICAgICAvLyBnZXQgZW1iZWRkaW5nIGZvciBoaWdobGlnaHRlZCB0ZXh0XHJcbiAgICAgIGF3YWl0IHRoaXMuc2VhcmNoKGhpZ2hsaWdodGVkX3RleHQpO1xyXG4gICAgICByZXR1cm47IC8vIGVuZHMgaGVyZSBpZiBjb250ZXh0IGlzIGEgc3RyaW5nXHJcbiAgICB9XHJcblxyXG4gICAgLyoqIFxyXG4gICAgICogQmVnaW4gZmlsZS1sZXZlbCBzZWFyY2hcclxuICAgICAqLyAgICBcclxuICAgIHRoaXMubmVhcmVzdCA9IG51bGw7XHJcbiAgICB0aGlzLmludGVydmFsX2NvdW50ID0gMDtcclxuICAgIHRoaXMucmVuZGVyaW5nID0gZmFsc2U7XHJcbiAgICB0aGlzLmZpbGUgPSBjb250ZXh0O1xyXG4gICAgLy8gaWYgdGhpcy5pbnRlcnZhbCBpcyBzZXQgdGhlbiBjbGVhciBpdFxyXG4gICAgaWYodGhpcy5pbnRlcnZhbCkge1xyXG4gICAgICBjbGVhckludGVydmFsKHRoaXMuaW50ZXJ2YWwpO1xyXG4gICAgICB0aGlzLmludGVydmFsID0gbnVsbDtcclxuICAgIH1cclxuICAgIC8vIHNldCBpbnRlcnZhbCB0byBjaGVjayBpZiBuZWFyZXN0IGlzIHNldFxyXG4gICAgdGhpcy5pbnRlcnZhbCA9IHNldEludGVydmFsKCgpID0+IHtcclxuICAgICAgaWYoIXRoaXMucmVuZGVyaW5nKXtcclxuICAgICAgICBpZih0aGlzLmZpbGUgaW5zdGFuY2VvZiBPYnNpZGlhbi5URmlsZSkge1xyXG4gICAgICAgICAgdGhpcy5yZW5kZXJpbmcgPSB0cnVlO1xyXG4gICAgICAgICAgdGhpcy5yZW5kZXJfbm90ZV9jb25uZWN0aW9ucyh0aGlzLmZpbGUpO1xyXG4gICAgICAgIH1lbHNle1xyXG4gICAgICAgICAgLy8gZ2V0IGN1cnJlbnQgbm90ZVxyXG4gICAgICAgICAgdGhpcy5maWxlID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcclxuICAgICAgICAgIC8vIGlmIHN0aWxsIG5vIGN1cnJlbnQgbm90ZSB0aGVuIHJldHVyblxyXG4gICAgICAgICAgaWYoIXRoaXMuZmlsZSAmJiB0aGlzLmNvdW50ID4gMSkge1xyXG4gICAgICAgICAgICBjbGVhckludGVydmFsKHRoaXMuaW50ZXJ2YWwpO1xyXG4gICAgICAgICAgICB0aGlzLnNldF9tZXNzYWdlKFwiXHU2NUUwXHU2RDNCXHU1MkE4XHU2NTg3XHU0RUY2XCIpO1xyXG4gICAgICAgICAgICByZXR1cm47IFxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgfWVsc2V7XHJcbiAgICAgICAgaWYodGhpcy5uZWFyZXN0KSB7XHJcbiAgICAgICAgICBjbGVhckludGVydmFsKHRoaXMuaW50ZXJ2YWwpO1xyXG4gICAgICAgICAgLy8gaWYgbmVhcmVzdCBpcyBhIHN0cmluZyB0aGVuIHVwZGF0ZSB2aWV3IG1lc3NhZ2VcclxuICAgICAgICAgIGlmICh0eXBlb2YgdGhpcy5uZWFyZXN0ID09PSBcInN0cmluZ1wiKSB7XHJcbiAgICAgICAgICAgIHRoaXMuc2V0X21lc3NhZ2UodGhpcy5uZWFyZXN0KTtcclxuICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIC8vIHNldCBuZWFyZXN0IGNvbm5lY3Rpb25zXHJcbiAgICAgICAgICAgIHRoaXMuc2V0X25lYXJlc3QodGhpcy5uZWFyZXN0LCBcIkZpbGU6IFwiICsgdGhpcy5maWxlLm5hbWUpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgLy8gaWYgcmVuZGVyX2xvZy5mYWlsZWRfZW1iZWRkaW5ncyB0aGVuIHVwZGF0ZSBmYWlsZWRfZW1iZWRkaW5ncy50eHRcclxuICAgICAgICAgIGlmICh0aGlzLnBsdWdpbi5yZW5kZXJfbG9nLmZhaWxlZF9lbWJlZGRpbmdzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2F2ZV9mYWlsZWRfZW1iZWRkaW5ncygpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgLy8gZ2V0IG9iamVjdCBrZXlzIG9mIHJlbmRlcl9sb2dcclxuICAgICAgICAgIHRoaXMucGx1Z2luLm91dHB1dF9yZW5kZXJfbG9nKCk7XHJcbiAgICAgICAgICByZXR1cm47IFxyXG4gICAgICAgIH1lbHNle1xyXG4gICAgICAgICAgdGhpcy5pbnRlcnZhbF9jb3VudCsrO1xyXG4gICAgICAgICAgdGhpcy5zZXRfbWVzc2FnZShcIlx1NkI2M1x1NTcyOFx1NTIxQlx1NUVGQVx1NjY3QVx1ODBGRFx1OEZERVx1NjNBNS4uLlwiK3RoaXMuaW50ZXJ2YWxfY291bnQpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfSwgMTApO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgcmVuZGVyX25vdGVfY29ubmVjdGlvbnMoZmlsZSkge1xyXG4gICAgdGhpcy5uZWFyZXN0ID0gYXdhaXQgdGhpcy5wbHVnaW4uZmluZF9ub3RlX2Nvbm5lY3Rpb25zKGZpbGUpO1xyXG4gIH1cclxuXHJcbiAgY2xlYXJfYXV0b19zZWFyY2hlcigpIHtcclxuICAgIGlmICh0aGlzLnNlYXJjaF90aW1lb3V0KSB7XHJcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLnNlYXJjaF90aW1lb3V0KTtcclxuICAgICAgdGhpcy5zZWFyY2hfdGltZW91dCA9IG51bGw7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBhc3luYyBzZWFyY2goc2VhcmNoX3RleHQsIHJlc3VsdHNfb25seT1mYWxzZSkge1xyXG4gICAgY29uc3QgbmVhcmVzdCA9IGF3YWl0IHRoaXMucGx1Z2luLmFwaS5zZWFyY2goc2VhcmNoX3RleHQpO1xyXG4gICAgLy8gcmVuZGVyIHJlc3VsdHMgaW4gdmlldyB3aXRoIGZpcnN0IDEwMCBjaGFyYWN0ZXJzIG9mIHNlYXJjaCB0ZXh0XHJcbiAgICBjb25zdCBuZWFyZXN0X2NvbnRleHQgPSBgU2VsZWN0aW9uOiBcIiR7c2VhcmNoX3RleHQubGVuZ3RoID4gMTAwID8gc2VhcmNoX3RleHQuc3Vic3RyaW5nKDAsIDEwMCkgKyBcIi4uLlwiIDogc2VhcmNoX3RleHR9XCJgO1xyXG4gICAgdGhpcy5zZXRfbmVhcmVzdChuZWFyZXN0LCBuZWFyZXN0X2NvbnRleHQsIHJlc3VsdHNfb25seSk7XHJcbiAgfVxyXG5cclxufVxyXG5jbGFzcyBTbWFydENvbm5lY3Rpb25zVmlld0FwaSB7XHJcbiAgY29uc3RydWN0b3IoYXBwLCBwbHVnaW4sIHZpZXcpIHtcclxuICAgIHRoaXMuYXBwID0gYXBwO1xyXG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XHJcbiAgICB0aGlzLnZpZXcgPSB2aWV3O1xyXG4gIH1cclxuICBhc3luYyBzZWFyY2ggKHNlYXJjaF90ZXh0KSB7XHJcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5wbHVnaW4uYXBpLnNlYXJjaChzZWFyY2hfdGV4dCk7XHJcbiAgfVxyXG4gIC8vIHRyaWdnZXIgcmVsb2FkIG9mIGVtYmVkZGluZ3MgZmlsZVxyXG4gIGFzeW5jIHJlbG9hZF9lbWJlZGRpbmdzX2ZpbGUoKSB7XHJcbiAgICBhd2FpdCB0aGlzLnBsdWdpbi5pbml0X3ZlY3MoKTtcclxuICAgIGF3YWl0IHRoaXMudmlldy5yZW5kZXJfY29ubmVjdGlvbnMoKTtcclxuICB9XHJcbn1cclxuY2xhc3MgU2NTZWFyY2hBcGkge1xyXG4gIGNvbnN0cnVjdG9yKGFwcCwgcGx1Z2luKSB7XHJcbiAgICB0aGlzLmFwcCA9IGFwcDtcclxuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xyXG4gIH1cclxuICBhc3luYyBzZWFyY2ggKHNlYXJjaF90ZXh0LCBmaWx0ZXI9e30pIHtcclxuICAgIGZpbHRlciA9IHtcclxuICAgICAgc2tpcF9zZWN0aW9uczogdGhpcy5wbHVnaW4uc2V0dGluZ3Muc2tpcF9zZWN0aW9ucyxcclxuICAgICAgLi4uZmlsdGVyXHJcbiAgICB9XHJcbiAgICBsZXQgbmVhcmVzdCA9IFtdO1xyXG4gICAgY29uc3QgcmVzcCA9IGF3YWl0IHRoaXMucGx1Z2luLnJlcXVlc3RfZW1iZWRkaW5nX2Zyb21faW5wdXQoc2VhcmNoX3RleHQpO1xyXG4gICAgaWYgKHJlc3AgJiYgcmVzcC5kYXRhICYmIHJlc3AuZGF0YVswXSAmJiByZXNwLmRhdGFbMF0uZW1iZWRkaW5nKSB7XHJcbiAgICAgIG5lYXJlc3QgPSB0aGlzLnBsdWdpbi5zbWFydF92ZWNfbGl0ZS5uZWFyZXN0KHJlc3AuZGF0YVswXS5lbWJlZGRpbmcsIGZpbHRlcik7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAvLyByZXNwIGlzIG51bGwsIHVuZGVmaW5lZCwgb3IgbWlzc2luZyBkYXRhXHJcbiAgICAgIG5ldyBPYnNpZGlhbi5Ob3RpY2UoXCJTbWFydCBDb25uZWN0aW9uczogRXJyb3IgZ2V0dGluZyBlbWJlZGRpbmdcIik7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbmVhcmVzdDtcclxuICB9XHJcbn1cclxuXHJcbmNsYXNzIFNtYXJ0Q29ubmVjdGlvbnNTZXR0aW5nc1RhYiBleHRlbmRzIE9ic2lkaWFuLlBsdWdpblNldHRpbmdUYWIge1xyXG4gIGNvbnN0cnVjdG9yKGFwcCwgcGx1Z2luKSB7XHJcbiAgICBzdXBlcihhcHAsIHBsdWdpbik7XHJcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcclxuICB9XHJcbiAgZGlzcGxheSgpIHtcclxuICAgIGNvbnN0IHtcclxuICAgICAgY29udGFpbmVyRWxcclxuICAgIH0gPSB0aGlzO1xyXG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcclxuXHJcbiAgICAvLyBjb250YWluZXJFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogXCJTdXBwb3J0ZXIgRmVhdHVyZXNcIiB9KTtcclxuICAgIC8vIC8vIGxpc3Qgc3VwcG9ydGVyIGJlbmVmaXRzXHJcbiAgICAvLyBjb250YWluZXJFbC5jcmVhdGVFbChcInBcIiwge1xyXG4gICAgLy8gICB0ZXh0OiBcIkFzIGEgU21hcnQgQ29ubmVjdGlvbnMgXFxcIlN1cHBvcnRlclxcXCIsIGZhc3QtdHJhY2sgeW91ciBQS00gam91cm5leSB3aXRoIHByaW9yaXR5IHBlcmtzIGFuZCBwaW9uZWVyaW5nIGlubm92YXRpb25zLlwiXHJcbiAgICAvLyB9KTtcclxuICAgIC8vIC8vIHRocmVlIGxpc3QgaXRlbXNcclxuICAgIC8vIGNvbnN0IHN1cHBvcnRlcl9iZW5lZml0c19saXN0ID0gY29udGFpbmVyRWwuY3JlYXRlRWwoXCJ1bFwiKTtcclxuICAgIC8vIHN1cHBvcnRlcl9iZW5lZml0c19saXN0LmNyZWF0ZUVsKFwibGlcIiwgeyB0ZXh0OiBcIkVuam95IHN3aWZ0LCB0b3AtcHJpb3JpdHkgc3VwcG9ydCBieSByZXBseWluZyB0byB5b3VyIHN1cHBvcnRlciBsaWNlbnNlIGtleSBlbWFpbC5cIiB9KTtcclxuICAgIC8vIHN1cHBvcnRlcl9iZW5lZml0c19saXN0LmNyZWF0ZUVsKFwibGlcIiwgeyB0ZXh0OiBcIkdhaW4gZWFybHkgYWNjZXNzIG5ldyB2ZXJzaW9ucyAodjIuMCBhdmFpbGFibGUgbm93KS5cIiB9KTtcclxuICAgIC8vIGNvbnN0IGdwdF9saSA9IHN1cHBvcnRlcl9iZW5lZml0c19saXN0LmNyZWF0ZUVsKFwibGlcIik7XHJcbiAgICAvLyBncHRfbGkuaW5uZXJIVE1MID0gJ0FjY2VzcyBleHBlcmltZW50YWwgZmVhdHVyZXMgbGlrZSB0aGUgPGEgaHJlZj1cImh0dHBzOi8vY2hhdC5vcGVuYWkuY29tL2cvZy1TbEREcDA3Ym0tc21hcnQtY29ubmVjdGlvbnMtZm9yLW9ic2lkaWFuXCIgdGFyZ2V0PVwiX2JsYW5rXCI+U21hcnQgQ29ubmVjdGlvbnMgR1BUPC9hPiBDaGF0R1BUIGludGVncmF0aW9uLic7XHJcbiAgICAvLyBzdXBwb3J0ZXJfYmVuZWZpdHNfbGlzdC5jcmVhdGVFbChcImxpXCIsIHsgdGV4dDogXCJTdGF5IGluZm9ybWVkIGFuZCBlbmdhZ2VkIHdpdGggZXhjbHVzaXZlIHN1cHBvcnRlci1vbmx5IGNvbW11bmljYXRpb25zLlwiIH0pO1xyXG4gICAgLy8gYnV0dG9uIFwiZ2V0IHYyXCJcclxuICAgIG5ldyBPYnNpZGlhbi5TZXR0aW5nKGNvbnRhaW5lckVsKS5zZXROYW1lKFwiXHU3MjQ4XHU2NzJDXHU2NkY0XHU2NUIwXCIpLnNldERlc2MoXCJcdTY2RjRcdTY1QjBcdTUyMzBcdTY3MDBcdTY1QjBcdTcyNDhcdTY3MkNcdUZGMENcdTRFRTVcdTgzQjdcdTUzRDZcdTY2RjRcdTU5MUFcdTUyOUZcdTgwRkRcIikuYWRkQnV0dG9uKChidXR0b24pID0+IGJ1dHRvbi5zZXRCdXR0b25UZXh0KFwiXHU2NkY0XHU2NUIwXCIpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xyXG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi51cGdyYWRlKCk7XHJcbiAgICB9KSk7XHJcbiAgICAvLyBhZGQgYnV0dG9uIHRvIHRyaWdnZXIgc3luYyBub3RlcyB0byB1c2Ugd2l0aCBDaGF0R1BUXHJcbiAgICBuZXcgT2JzaWRpYW4uU2V0dGluZyhjb250YWluZXJFbCkuc2V0TmFtZShcIlx1NTQwQ1x1NkI2NVx1N0IxNFx1OEJCMFwiKS5zZXREZXNjKFwiXHU5MDFBXHU4RkM3IFNtYXJ0IENvbm5lY3Rpb25zIFx1NjcwRFx1NTJBMVx1NTY2OFx1NTQwQ1x1NkI2NVx1N0IxNFx1OEJCMFx1MzAwMlx1NjUyRlx1NjMwMVx1NEUwQlx1OTc2Mlx1OTE0RFx1N0Y2RVx1NzY4NFx1NjM5Mlx1OTY2NFx1OEJCRVx1N0Y2RVx1MzAwMlwiKS5hZGRCdXR0b24oKGJ1dHRvbikgPT4gYnV0dG9uLnNldEJ1dHRvblRleHQoXCJcdTU0MENcdTZCNjVcdTdCMTRcdThCQjBcIikub25DbGljayhhc3luYyAoKSA9PiB7XHJcbiAgICAgIC8vIHN5bmMgbm90ZXNcclxuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc3luY19ub3RlcygpO1xyXG4gICAgfSkpO1xyXG4gICAgLy8gLy8gYWRkIGEgdGV4dCBpbnB1dCB0byBlbnRlciBzdXBwb3J0ZXIgbGljZW5zZSBrZXlcclxuICAgIC8vIG5ldyBPYnNpZGlhbi5TZXR0aW5nKGNvbnRhaW5lckVsKS5zZXROYW1lKFwiU3VwcG9ydGVyIExpY2Vuc2UgS2V5XCIpLnNldERlc2MoXCJOb3RlOiB0aGlzIGlzIG5vdCByZXF1aXJlZCB0byB1c2UgU21hcnQgQ29ubmVjdGlvbnMuXCIpLmFkZFRleHQoKHRleHQpID0+IHRleHQuc2V0UGxhY2Vob2xkZXIoXCJFbnRlciB5b3VyIGxpY2Vuc2Vfa2V5XCIpLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmxpY2Vuc2Vfa2V5KS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcclxuICAgIC8vICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MubGljZW5zZV9rZXkgPSB2YWx1ZS50cmltKCk7XHJcbiAgICAvLyAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncyh0cnVlKTtcclxuICAgIC8vIH0pKTtcclxuICAgIC8vIC8vIGFkZCBidXR0b24gdG8gYmVjb21lIGEgc3VwcG9ydGVyXHJcbiAgICBuZXcgT2JzaWRpYW4uU2V0dGluZyhjb250YWluZXJFbCkuc2V0TmFtZShcIlx1NjUyRlx1NjMwMSBTbWFydCBDb25uZWN0aW9ucyBcdTRFMkRcdTY1ODdcdTcyNDhcIikuc2V0RGVzYyhcIlx1NjUyRlx1NjMwMVx1NEUwMFx1NEUwQlx1NTQyN1wiKS5hZGRCdXR0b24oKGJ1dHRvbikgPT4gYnV0dG9uLnNldEJ1dHRvblRleHQoXCJcdTY1MkZcdTYzMDEoXHU1RkFFXHU0RkUxXHU2NTM2XHU2QjNFXHU3ODAxKVwiKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgcGF5bWVudF9wYWdlcyA9IFtcclxuICAgICAgICAgIFwiaHR0cHM6Ly9taXIudWcwLmx0ZC9zdGF0aWMvaW1hZ2Uvd2VjaGF0cGF5LnBuZ1wiLFxyXG4gICAgICBdO1xyXG4gICAgICBpZighdGhpcy5wbHVnaW4ucGF5bWVudF9wYWdlX2luZGV4KXtcclxuICAgICAgICB0aGlzLnBsdWdpbi5wYXltZW50X3BhZ2VfaW5kZXggPSBNYXRoLnJvdW5kKE1hdGgucmFuZG9tKCkpO1xyXG4gICAgICB9XHJcbiAgICAgIC8vIG9wZW4gc3VwcG9ydGVyIHBhZ2UgaW4gYnJvd3NlclxyXG4gICAgICB3aW5kb3cub3BlbihwYXltZW50X3BhZ2VzW3RoaXMucGx1Z2luLnBheW1lbnRfcGFnZV9pbmRleF0pO1xyXG4gICAgfSkpO1xyXG5cclxuICAgIFxyXG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJoMlwiLCB7XHJcbiAgICAgIHRleHQ6IFwiXHU2QTIxXHU1NzhCXHU4QkJFXHU3RjZFXCJcclxuICAgIH0pO1xyXG4gICAgLy8gYWRkIGEgdGV4dCBpbnB1dCB0byBlbnRlciB0aGUgQVBJIGtleVxyXG4gICAgbmV3IE9ic2lkaWFuLlNldHRpbmcoY29udGFpbmVyRWwpLnNldE5hbWUoXCJcdThCQkVcdTdGNkUgT3BlbkFJIEFQSSBcdTVCQzZcdTk0QTVcIikuc2V0RGVzYyhcIlx1NUZDNVx1NTg2QjogXHU0RjdGXHU3NTI4XHU2NzJDXHU2M0QyXHU0RUY2XHU1RkM1XHU5ODdCXHU1ODZCXHU1MTk5XHU2QjY0XHU1QjU3XHU2QkI1XCIpLmFkZFRleHQoKHRleHQpID0+IHRleHQuc2V0UGxhY2Vob2xkZXIoXCJcdThGOTNcdTUxNjUgT3BlbkFJIEFQSSBrZXlcIikuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuYXBpX2tleSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmFwaV9rZXkgPSB2YWx1ZS50cmltKCk7XHJcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncyh0cnVlKTtcclxuICAgIH0pKTtcclxuICAgIC8vIGFkZCBhIHRleHQgaW5wdXQgdG8gZW50ZXIgdGhlIEFQSSBlbmRwb2ludFxyXG4gICAgbmV3IE9ic2lkaWFuLlNldHRpbmcoY29udGFpbmVyRWwpLnNldE5hbWUoXCJcdThCQkVcdTdGNkUgT3BlbkFJIEFQSSBcdTYzQTVcdTUxNjVcdTU3MzBcdTU3NDBcIikuc2V0RGVzYyhcIlx1NTNFRlx1OTAwOVx1RkYxQVx1NTk4Mlx1Njc5QyBPcGVuQUkgQVBJIFx1NTNFRlx1NzUyOFx1NjAyN1x1NkQ0Qlx1OEJENVx1NTkzMVx1OEQyNVx1RkYwQ1x1NUVGQVx1OEJBRVx1NjZGNFx1NjM2Mlx1NTE3Nlx1NEVENlx1NjNBNVx1NTE2NVx1NTczMFx1NTc0MFwiKS5hZGRUZXh0KCh0ZXh0KSA9PiB0ZXh0LnNldFBsYWNlaG9sZGVyKFwiXHU4RjkzXHU1MTY1IE9wZW5BSSBBUEkgXHU2M0E1XHU1MTY1XHU1NzMwXHU1NzQwXCIpLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmFwaV9lbmRwb2ludCkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmFwaV9lbmRwb2ludCA9IHZhbHVlLnRyaW0oKTtcclxuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKHRydWUpO1xyXG4gICAgfSkpO1xyXG4gICAgLy8gYWRkIGEgYnV0dG9uIHRvIHRlc3QgdGhlIEFQSSBrZXkgaXMgd29ya2luZ1xyXG4gICAgbmV3IE9ic2lkaWFuLlNldHRpbmcoY29udGFpbmVyRWwpLnNldE5hbWUoXCJcdTZENEJcdThCRDUgT3BlbkFJIEFQSSBcdTUzRUZcdTc1MjhcdTYwMjdcIikuc2V0RGVzYyhcIlx1NkQ0Qlx1OEJENSBPcGVuQUkgQVBJIFx1NTNFRlx1NzUyOFx1NjAyN1wiKS5hZGRCdXR0b24oKGJ1dHRvbikgPT4gYnV0dG9uLnNldEJ1dHRvblRleHQoXCJcdTZENEJcdThCRDVcIikub25DbGljayhhc3luYyAoKSA9PiB7XHJcbiAgICAgIC8vIHRlc3QgQVBJIGtleVxyXG4gICAgICBjb25zdCByZXNwID0gYXdhaXQgdGhpcy5wbHVnaW4udGVzdF9hcGlfa2V5KCk7XHJcbiAgICAgIGlmKHJlc3ApIHtcclxuICAgICAgICBuZXcgT2JzaWRpYW4uTm90aWNlKFwiU21hcnQgQ29ubmVjdGlvbnM6IE9wZW5BSSBBUEkgXHU2NzA5XHU2NTQ4XHVGRjAxXCIpO1xyXG4gICAgICB9ZWxzZXtcclxuICAgICAgICBuZXcgT2JzaWRpYW4uTm90aWNlKFwiU21hcnQgQ29ubmVjdGlvbnM6IE9wZW5BSSBBUEkgXHU2NUUwXHU2Q0Q1XHU0RjdGXHU3NTI4XHVGRjAxXCIpO1xyXG4gICAgICB9XHJcbiAgICB9KSk7XHJcbiAgICAvLyBhZGQgZHJvcGRvd24gdG8gc2VsZWN0IHRoZSBtb2RlbFxyXG4gICAgbmV3IE9ic2lkaWFuLlNldHRpbmcoY29udGFpbmVyRWwpLnNldE5hbWUoXCJcdTVCRjlcdThCRERcdTZBMjFcdTU3OEJcIikuc2V0RGVzYyhcIlx1OTAwOVx1NjJFOVx1NzUyOFx1NEU4RVx1NUJGOVx1OEJERFx1NzY4NFx1NkEyMVx1NTc4QlwiKS5hZGREcm9wZG93bigoZHJvcGRvd24pID0+IHtcclxuICAgICAgZHJvcGRvd24uYWRkT3B0aW9uKFwiZ3B0LTMuNS10dXJiby0xNmtcIiwgXCJncHQtMy41LXR1cmJvLTE2a1wiKTtcclxuICAgICAgZHJvcGRvd24uYWRkT3B0aW9uKFwiZ3B0LTRcIiwgXCJncHQtNCAoOGspXCIpO1xyXG4gICAgICBkcm9wZG93bi5hZGRPcHRpb24oXCJncHQtMy41LXR1cmJvXCIsIFwiZ3B0LTMuNS10dXJibyAoNGspXCIpO1xyXG4gICAgICBkcm9wZG93bi5hZGRPcHRpb24oXCJncHQtNC0xMTA2LXByZXZpZXdcIiwgXCJncHQtNC10dXJibyAoMTI4aylcIik7XHJcbiAgICAgIGRyb3Bkb3duLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnNtYXJ0X2NoYXRfbW9kZWwgPSB2YWx1ZTtcclxuICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgfSk7XHJcbiAgICAgIGRyb3Bkb3duLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLnNtYXJ0X2NoYXRfbW9kZWwpO1xyXG4gICAgfSk7XHJcbiAgICAvLyBsYW5ndWFnZVxyXG4gICAgLy8gbmV3IE9ic2lkaWFuLlNldHRpbmcoY29udGFpbmVyRWwpLnNldE5hbWUoXCJEZWZhdWx0IExhbmd1YWdlXCIpLnNldERlc2MoXCJEZWZhdWx0IGxhbmd1YWdlIHRvIHVzZSBmb3IgU21hcnQgQ2hhdC4gQ2hhbmdlcyB3aGljaCBzZWxmLXJlZmVyZW50aWFsIHByb25vdW5zIHdpbGwgdHJpZ2dlciBsb29rdXAgb2YgeW91ciBub3Rlcy5cIikuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PiB7XHJcbiAgICAvLyAgIC8vIGdldCBPYmplY3Qga2V5cyBmcm9tIHByb25vdXNcclxuICAgIC8vICAgY29uc3QgbGFuZ3VhZ2VzID0gT2JqZWN0LmtleXMoU01BUlRfVFJBTlNMQVRJT04pO1xyXG4gICAgLy8gICBmb3IobGV0IGkgPSAwOyBpIDwgbGFuZ3VhZ2VzLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAvLyAgICAgZHJvcGRvd24uYWRkT3B0aW9uKGxhbmd1YWdlc1tpXSwgbGFuZ3VhZ2VzW2ldKTtcclxuICAgIC8vICAgfVxyXG4gICAgLy8gICBkcm9wZG93bi5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcclxuICAgIC8vICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5sYW5ndWFnZSA9IHZhbHVlO1xyXG4gICAgLy8gICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgLy8gICAgIHNlbGZfcmVmX3Byb25vdW5zX2xpc3Quc2V0VGV4dCh0aGlzLmdldF9zZWxmX3JlZl9saXN0KCkpO1xyXG4gICAgLy8gICAgIC8vIGlmIGNoYXQgdmlldyBpcyBvcGVuIHRoZW4gcnVuIG5ld19jaGF0KClcclxuICAgIC8vICAgICBjb25zdCBjaGF0X3ZpZXcgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFNNQVJUX0NPTk5FQ1RJT05TX0NIQVRfVklFV19UWVBFKS5sZW5ndGggPiAwID8gdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShTTUFSVF9DT05ORUNUSU9OU19DSEFUX1ZJRVdfVFlQRSlbMF0udmlldyA6IG51bGw7XHJcbiAgICAvLyAgICAgaWYoY2hhdF92aWV3KSB7XHJcbiAgICAvLyAgICAgICBjaGF0X3ZpZXcubmV3X2NoYXQoKTtcclxuICAgIC8vICAgICB9XHJcbiAgICAvLyAgIH0pO1xyXG4gICAgLy8gICBkcm9wZG93bi5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5sYW5ndWFnZSk7XHJcbiAgICAvLyB9KTtcclxuICAgIC8vIGxpc3QgY3VycmVudCBzZWxmLXJlZmVyZW50aWFsIHByb25vdW5zXHJcblxyXG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJoMlwiLCB7XHJcbiAgICAgIHRleHQ6IFwiXHU2MzkyXHU5NjY0XCJcclxuICAgIH0pO1xyXG4gICAgLy8gbGlzdCBmaWxlIGV4Y2x1c2lvbnNcclxuICAgIG5ldyBPYnNpZGlhbi5TZXR0aW5nKGNvbnRhaW5lckVsKS5zZXROYW1lKFwiXHU2MzkyXHU5NjY0XHU2NTg3XHU0RUY2XCIpLnNldERlc2MoXCJcdThGOTNcdTUxNjVcdTk3MDBcdTg5ODFcdTYzOTJcdTk2NjRcdTc2ODRcdTY1ODdcdTRFRjZcdTU0MERcdUZGMENcdTc1MjhcdTkwMTdcdTUzRjdcdTUyMDZcdTk2OTRcdTY1ODdcdTRFRjZcIikuYWRkVGV4dCgodGV4dCkgPT4gdGV4dC5zZXRQbGFjZWhvbGRlcihcImRyYXdpbmdzLHByb21wdHMvbG9nc1wiKS5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5maWxlX2V4Y2x1c2lvbnMpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5maWxlX2V4Y2x1c2lvbnMgPSB2YWx1ZTtcclxuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICB9KSk7XHJcbiAgICAvLyBsaXN0IGZvbGRlciBleGNsdXNpb25zXHJcbiAgICBuZXcgT2JzaWRpYW4uU2V0dGluZyhjb250YWluZXJFbCkuc2V0TmFtZShcIlx1NjM5Mlx1OTY2NFx1NjU4N1x1NEVGNlx1NTkzOVwiKS5zZXREZXNjKFwiXHU4RjkzXHU1MTY1XHU5NzAwXHU4OTgxXHU2MzkyXHU5NjY0XHU3Njg0XHU2NTg3XHU0RUY2XHU1OTM5XHU1NDBEXHVGRjBDXHU3NTI4XHU5MDE3XHU1M0Y3XHU1MjA2XHU5Njk0XHU1OTFBXHU0RTJBXHU2NTg3XHU0RUY2XHU1OTM5XCIpLmFkZFRleHQoKHRleHQpID0+IHRleHQuc2V0UGxhY2Vob2xkZXIoXCJkcmF3aW5ncyxwcm9tcHRzL2xvZ3NcIikuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuZm9sZGVyX2V4Y2x1c2lvbnMpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5mb2xkZXJfZXhjbHVzaW9ucyA9IHZhbHVlO1xyXG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgIH0pKTtcclxuICAgIC8vIGxpc3QgcGF0aCBvbmx5IG1hdGNoZXJzXHJcbiAgICBuZXcgT2JzaWRpYW4uU2V0dGluZyhjb250YWluZXJFbCkuc2V0TmFtZShcIlx1NEVDNVx1NEY3Rlx1NzUyOFx1NjdEMFx1NEUyQVx1OERFRlx1NUY4NFwiKS5zZXREZXNjKFwiXHU4RjkzXHU1MTY1XHU5NzAwXHU4OTgxXHU0RjdGXHU3NTI4XHU3Njg0XHU4REVGXHU1Rjg0XHVGRjBDXHU3NTI4XHU5MDE3XHU1M0Y3XHU1MjA2XHU5Njk0XHU1OTFBXHU0RTJBXHU4REVGXHU1Rjg0XCIpLmFkZFRleHQoKHRleHQpID0+IHRleHQuc2V0UGxhY2Vob2xkZXIoXCJkcmF3aW5ncyxwcm9tcHRzL2xvZ3NcIikuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MucGF0aF9vbmx5KS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcclxuICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MucGF0aF9vbmx5ID0gdmFsdWU7XHJcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgfSkpO1xyXG4gICAgLy8gbGlzdCBoZWFkZXIgZXhjbHVzaW9uc1xyXG4gICAgbmV3IE9ic2lkaWFuLlNldHRpbmcoY29udGFpbmVyRWwpLnNldE5hbWUoXCJcdTYzOTJcdTk2NjRcdTY4MDdcdTk4OThcIikuc2V0RGVzYyhcIlx1OEY5M1x1NTE2NVx1OTcwMFx1ODk4MVx1NjM5Mlx1OTY2NFx1NzY4NFx1NjgwN1x1OTg5OFx1RkYwQ1x1NzUyOFx1OTAxN1x1NTNGN1x1NTIwNlx1OTY5NFx1NTkxQVx1NEUyQVx1NjgwN1x1OTg5OChcdTUzRUFcdTkwMDJcdTc1MjhcdTRFOEVcdTUzM0FcdTU3NTcpXCIpLmFkZFRleHQoKHRleHQpID0+IHRleHQuc2V0UGxhY2Vob2xkZXIoXCJkcmF3aW5ncyxwcm9tcHRzL2xvZ3NcIikuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuaGVhZGVyX2V4Y2x1c2lvbnMpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5oZWFkZXJfZXhjbHVzaW9ucyA9IHZhbHVlO1xyXG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgIH0pKTtcclxuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiaDJcIiwge1xyXG4gICAgICB0ZXh0OiBcIlx1NjYzRVx1NzkzQVx1OEJCRVx1N0Y2RVwiXHJcbiAgICB9KTtcclxuICAgIC8vIHRvZ2dsZSBzaG93aW5nIGZ1bGwgcGF0aCBpbiB2aWV3XHJcbiAgICBuZXcgT2JzaWRpYW4uU2V0dGluZyhjb250YWluZXJFbCkuc2V0TmFtZShcIlx1NjYzRVx1NzkzQVx1NUI4Q1x1NjU3NFx1OERFRlx1NUY4NFwiKS5zZXREZXNjKFwiXHU1NzI4XHU4OUM2XHU1NkZFXHU0RTJEXHU2NjNFXHU3OTNBXHU1MTczXHU4MDU0XHU3QjE0XHU4QkIwXHU3Njg0XHU1QjhDXHU2NTc0XHU4REVGXHU1Rjg0XCIpLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PiB0b2dnbGUuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3Muc2hvd19mdWxsX3BhdGgpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5zaG93X2Z1bGxfcGF0aCA9IHZhbHVlO1xyXG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3ModHJ1ZSk7XHJcbiAgICB9KSk7XHJcbiAgICAvLyB0b2dnbGUgZXhwYW5kZWQgdmlldyBieSBkZWZhdWx0XHJcbiAgICBuZXcgT2JzaWRpYW4uU2V0dGluZyhjb250YWluZXJFbCkuc2V0TmFtZShcIlx1NUM1NVx1NUYwMFx1N0IxNFx1OEJCMFwiKS5zZXREZXNjKFwiXHU5RUQ4XHU4QkE0XHU1QzU1XHU1RjAwXHU1MTczXHU4MDU0XHU3QjE0XHU4QkIwXHU3Njg0XHU1MTg1XHU1QkI5XCIpLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PiB0b2dnbGUuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuZXhwYW5kZWRfdmlldykub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmV4cGFuZGVkX3ZpZXcgPSB2YWx1ZTtcclxuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKHRydWUpO1xyXG4gICAgfSkpO1xyXG4gICAgLy8gdG9nZ2xlIGdyb3VwIG5lYXJlc3QgYnkgZmlsZVxyXG4gICAgbmV3IE9ic2lkaWFuLlNldHRpbmcoY29udGFpbmVyRWwpLnNldE5hbWUoXCJcdTYzMDlcdTY1ODdcdTRFRjZcdTY4QzBcdTdEMjJcdTUxNzNcdTgwNTRcdTVFQTZcIikuc2V0RGVzYyhcIlx1NjMwOVx1NjU4N1x1NEVGNlx1NjhDMFx1N0QyMlx1NTE3M1x1ODA1NFx1NUVBNlx1RkYwOFx1NTE3M1x1OTVFRFx1NTQwRVx1NjMwOVx1NjgwN1x1OTg5OFx1NjhDMFx1N0QyMlx1NTE3M1x1ODA1NFx1NUVBNlx1RkYwOVwiKS5hZGRUb2dnbGUoKHRvZ2dsZSkgPT4gdG9nZ2xlLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmdyb3VwX25lYXJlc3RfYnlfZmlsZSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmdyb3VwX25lYXJlc3RfYnlfZmlsZSA9IHZhbHVlO1xyXG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3ModHJ1ZSk7XHJcbiAgICB9KSk7XHJcbiAgICAvLyB0b2dnbGUgdmlld19vcGVuIG9uIE9ic2lkaWFuIHN0YXJ0dXBcclxuICAgIG5ldyBPYnNpZGlhbi5TZXR0aW5nKGNvbnRhaW5lckVsKS5zZXROYW1lKFwiXHU4MUVBXHU1MkE4XHU2MjUzXHU1RjAwXHU1MTczXHU3Q0ZCXHU4OUM2XHU1NkZFXCIpLnNldERlc2MoXCJPcGVuIHZpZXcgb24gT2JzaWRpYW4gc3RhcnR1cC5cIikuYWRkVG9nZ2xlKCh0b2dnbGUpID0+IHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy52aWV3X29wZW4pLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy52aWV3X29wZW4gPSB2YWx1ZTtcclxuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKHRydWUpO1xyXG4gICAgfSkpO1xyXG4gICAgLy8gdG9nZ2xlIGNoYXRfb3BlbiBvbiBPYnNpZGlhbiBzdGFydHVwXHJcbiAgICBuZXcgT2JzaWRpYW4uU2V0dGluZyhjb250YWluZXJFbCkuc2V0TmFtZShcIlx1ODFFQVx1NTJBOFx1NjI1M1x1NUYwMFx1NUJGOVx1OEJERFx1N0E5N1x1NTNFM1wiKS5zZXREZXNjKFwiXHU1NDJGXHU1MkE4IE9ic2lkaWFuIFx1NjVGNlx1ODFFQVx1NTJBOFx1NjI1M1x1NUYwMFx1NUJGOVx1OEJERFx1N0E5N1x1NTNFM1wiKS5hZGRUb2dnbGUoKHRvZ2dsZSkgPT4gdG9nZ2xlLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmNoYXRfb3Blbikub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmNoYXRfb3BlbiA9IHZhbHVlO1xyXG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3ModHJ1ZSk7XHJcbiAgICB9KSk7XHJcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcImgyXCIsIHtcclxuICAgICAgdGV4dDogXCJcdTlBRDhcdTdFQTdcdThCQkVcdTdGNkVcIlxyXG4gICAgfSk7XHJcbiAgICAvLyB0b2dnbGUgbG9nX3JlbmRlclxyXG4gICAgbmV3IE9ic2lkaWFuLlNldHRpbmcoY29udGFpbmVyRWwpLnNldE5hbWUoXCJcdTY1RTVcdTVGRDdcdTZFMzJcdTY3RDNcIikuc2V0RGVzYyhcIlx1NUMwNlx1NkUzMlx1NjdEM1x1OEJFNlx1N0VDNlx1NEZFMVx1NjA2Rlx1OEJCMFx1NUY1NVx1NTIzMFx1NjNBN1x1NTIzNlx1NTNGMChcdTUzMDVcdTYyRUN0b2tlblx1NEY3Rlx1NzUyOFx1OTFDRilcIikuYWRkVG9nZ2xlKCh0b2dnbGUpID0+IHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5sb2dfcmVuZGVyKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcclxuICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MubG9nX3JlbmRlciA9IHZhbHVlO1xyXG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3ModHJ1ZSk7XHJcbiAgICB9KSk7XHJcbiAgICAvLyB0b2dnbGUgZmlsZXMgaW4gbG9nX3JlbmRlclxyXG4gICAgbmV3IE9ic2lkaWFuLlNldHRpbmcoY29udGFpbmVyRWwpLnNldE5hbWUoXCJcdThCQjBcdTVGNTVcdTZFMzJcdTY3RDNcdTY1ODdcdTRFRjZcIikuc2V0RGVzYyhcIlx1NEY3Rlx1NzUyOFx1NjVFNVx1NUZEN1x1NkUzMlx1NjdEM1x1OEJCMFx1NUY1NVx1NUQ0Q1x1NTE2NVx1NUYwRlx1NUJGOVx1OEM2MVx1NzY4NFx1OERFRlx1NUY4NChcdTc1MjhcdTRFOEVcdThDMDNcdThCRDUpXCIpLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PiB0b2dnbGUuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MubG9nX3JlbmRlcl9maWxlcykub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmxvZ19yZW5kZXJfZmlsZXMgPSB2YWx1ZTtcclxuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKHRydWUpO1xyXG4gICAgfSkpO1xyXG4gICAgLy8gdG9nZ2xlIHNraXBfc2VjdGlvbnNcclxuICAgIG5ldyBPYnNpZGlhbi5TZXR0aW5nKGNvbnRhaW5lckVsKS5zZXROYW1lKFwiXHU4REYzXHU4RkM3XHU3Mjc5XHU1QjlBXHU5MEU4XHU1MjA2XCIpLnNldERlc2MoXCJcdThERjNcdThGQzdcdTVCRjlcdTdCMTRcdThCQjBcdTRFMkRcdTc2ODRcdTcyNzlcdTVCOUFcdTkwRThcdTUyMDZcdTVFRkFcdTdBQ0JcdThGREVcdTYzQTVcdTMwMDJcdThCNjZcdTU0NEFcdUZGMUFcdTY3MDlcdTU5MjdcdTY1ODdcdTRFRjZcdTY1RjZcdTRGMUFcdTk2NERcdTRGNEVcdTRGN0ZcdTc1MjhcdTY1NDhcdTczODdcdUZGMENcdTY3MkFcdTY3NjVcdTRGN0ZcdTc1MjhcdTY1RjZcdTk3MDBcdTg5ODFcdTIwMUNcdTVGM0FcdTUyMzZcdTUyMzdcdTY1QjBcdTIwMURcdTMwMDJcIikuYWRkVG9nZ2xlKCh0b2dnbGUpID0+IHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5za2lwX3NlY3Rpb25zKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcclxuICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Muc2tpcF9zZWN0aW9ucyA9IHZhbHVlO1xyXG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3ModHJ1ZSk7XHJcbiAgICB9KSk7XHJcbiAgICAvLyB0ZXN0IGZpbGUgd3JpdGluZyBieSBjcmVhdGluZyBhIHRlc3QgZmlsZSwgdGhlbiB3cml0aW5nIGFkZGl0aW9uYWwgZGF0YSB0byB0aGUgZmlsZSwgYW5kIHJldHVybmluZyBhbnkgZXJyb3IgdGV4dCBpZiBpdCBmYWlsc1xyXG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJoM1wiLCB7XHJcbiAgICAgIHRleHQ6IFwiXHU2RDRCXHU4QkQ1XHU2NTg3XHU0RUY2XHU1MTk5XHU1MTY1XCJcclxuICAgIH0pO1xyXG4gICAgLy8gbWFudWFsIHNhdmUgYnV0dG9uXHJcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcImgzXCIsIHtcclxuICAgICAgdGV4dDogXCJcdTYyNEJcdTUyQThcdTRGRERcdTVCNThcIlxyXG4gICAgfSk7XHJcbiAgICBsZXQgbWFudWFsX3NhdmVfcmVzdWx0cyA9IGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiZGl2XCIpO1xyXG4gICAgbmV3IE9ic2lkaWFuLlNldHRpbmcoY29udGFpbmVyRWwpLnNldE5hbWUoXCJcdTYyNEJcdTUyQThcdTRGRERcdTVCNThcIikuc2V0RGVzYyhcIlx1NEZERFx1NUI1OFx1NUY1M1x1NTI0RFx1NURGMlx1NUQ0Q1x1NTE2NVx1NzY4NFx1NTE4NVx1NUJCOVwiKS5hZGRCdXR0b24oKGJ1dHRvbikgPT4gYnV0dG9uLnNldEJ1dHRvblRleHQoXCJcdTYyNEJcdTUyQThcdTRGRERcdTVCNThcIikub25DbGljayhhc3luYyAoKSA9PiB7XHJcbiAgICAgIC8vIGNvbmZpcm1cclxuICAgICAgaWYgKGNvbmZpcm0oXCJcdTRGNjBcdTc4NkVcdTVCOUFcdTg5ODFcdTRGRERcdTVCNThcdTVGNTNcdTUyNERcdTVERjJcdTVENENcdTUxNjVcdTc2ODRcdTUxODVcdTVCQjlcdTU0MTdcdUZGMUZcIikpIHtcclxuICAgICAgICAvLyBzYXZlXHJcbiAgICAgICAgdHJ5e1xyXG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZV9lbWJlZGRpbmdzX3RvX2ZpbGUodHJ1ZSk7XHJcbiAgICAgICAgICBtYW51YWxfc2F2ZV9yZXN1bHRzLmlubmVySFRNTCA9IFwiXHU1RDRDXHU1MTY1XHU1MTg1XHU1QkI5XHU0RkREXHU1QjU4XHU2MjEwXHU1MjlGXHUzMDAyXCI7XHJcbiAgICAgICAgfWNhdGNoKGUpe1xyXG4gICAgICAgICAgbWFudWFsX3NhdmVfcmVzdWx0cy5pbm5lckhUTUwgPSBcIlx1NUQ0Q1x1NTE2NVx1NTE4NVx1NUJCOVx1NEZERFx1NUI1OFx1NTkzMVx1OEQyNVx1MzAwMlx1OTUxOVx1OEJFRlx1RkYxQVwiICsgZTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH0pKTtcclxuXHJcbiAgICAvLyBsaXN0IHByZXZpb3VzbHkgZmFpbGVkIGZpbGVzXHJcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcImgzXCIsIHtcclxuICAgICAgdGV4dDogXCJQcmV2aW91c2x5IGZhaWxlZCBmaWxlc1wiXHJcbiAgICB9KTtcclxuICAgIGxldCBmYWlsZWRfbGlzdCA9IGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiZGl2XCIpO1xyXG4gICAgdGhpcy5kcmF3X2ZhaWxlZF9maWxlc19saXN0KGZhaWxlZF9saXN0KTtcclxuXHJcbiAgICAvLyBmb3JjZSByZWZyZXNoIGJ1dHRvblxyXG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJoM1wiLCB7XHJcbiAgICAgIHRleHQ6IFwiXHU1RjNBXHU1MjM2XHU1MjM3XHU2NUIwXCJcclxuICAgIH0pO1xyXG4gICAgbmV3IE9ic2lkaWFuLlNldHRpbmcoY29udGFpbmVyRWwpLnNldE5hbWUoXCJcdTVGM0FcdTUyMzZcdTUyMzdcdTY1QjBcIikuc2V0RGVzYyhcIlx1OEI2Nlx1NTQ0QVx1RkYxQVx1OTY2NFx1OTc1RVx1NEY2MFx1NzdFNVx1OTA1M1x1ODFFQVx1NURGMVx1NTcyOFx1NTA1QVx1NEVDMFx1NEU0OFx1RkYwQ1x1NTQyNlx1NTIxOVx1NEUwRFx1ODk4MVx1NEY3Rlx1NzUyOFx1RkYwMVx1OEZEOVx1NUMwNlx1NTIyMFx1OTY2NFx1NjU3MFx1NjM2RVx1NUU5M1x1NEUyRFx1NjI0MFx1NjcwOVx1NURGMlx1NUQ0Q1x1NTE2NVx1NzY4NFx1NTE4NVx1NUJCOVx1RkYwQ1x1NUU3Nlx1OTFDRFx1NjVCMFx1NzUxRlx1NjIxMFx1NjU3NFx1NEUyQVx1NjU3MFx1NjM2RVx1NUU5M1x1RkYwMVwiKS5hZGRCdXR0b24oKGJ1dHRvbikgPT4gYnV0dG9uLnNldEJ1dHRvblRleHQoXCJGb3JjZSBSZWZyZXNoXCIpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xyXG4gICAgICAvLyBjb25maXJtXHJcbiAgICAgIGlmIChjb25maXJtKFwiXHU3ODZFXHU1QjlBXHU4OTgxXHU1RjNBXHU1MjM2XHU1MjM3XHU2NUIwXHU1NDE3XHVGRjFGXHU3MEI5XHU1MUZCXHUyMDFDXHU3ODZFXHU1QjlBXHUyMDFEXHU4ODY4XHU3OTNBXHU2MEE4XHU3NDA2XHU4OUUzXHU4RkQ5XHU0RTJBXHU2NENEXHU0RjVDXHU1RTI2XHU2NzY1XHU3Njg0XHU1NDBFXHU2NzlDXHUzMDAyXCIpKSB7XHJcbiAgICAgICAgLy8gZm9yY2UgcmVmcmVzaFxyXG4gICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLmZvcmNlX3JlZnJlc2hfZW1iZWRkaW5nc19maWxlKCk7XHJcbiAgICAgIH1cclxuICAgIH0pKTtcclxuXHJcbiAgfVxyXG4gIGRyYXdfZmFpbGVkX2ZpbGVzX2xpc3QoZmFpbGVkX2xpc3QpIHtcclxuICAgIGZhaWxlZF9saXN0LmVtcHR5KCk7XHJcbiAgICBpZih0aGlzLnBsdWdpbi5zZXR0aW5ncy5mYWlsZWRfZmlsZXMubGVuZ3RoID4gMCkge1xyXG4gICAgICAvLyBhZGQgbWVzc2FnZSB0aGF0IHRoZXNlIGZpbGVzIHdpbGwgYmUgc2tpcHBlZCB1bnRpbCBtYW51YWxseSByZXRyaWVkXHJcbiAgICAgIGZhaWxlZF9saXN0LmNyZWF0ZUVsKFwicFwiLCB7XHJcbiAgICAgICAgdGV4dDogXCJcdTRFRTVcdTRFMEJcdTY1ODdcdTRFRjZcdTU5MDRcdTc0MDZcdTU5MzFcdThEMjVcdUZGMENcdTVDMDZcdTg4QUJcdThERjNcdThGQzdcdUZGMENcdTc2RjRcdTUyMzBcdTYyNEJcdTUyQThcdTkxQ0RcdThCRDVcdTMwMDJcIlxyXG4gICAgICB9KTtcclxuICAgICAgbGV0IGxpc3QgPSBmYWlsZWRfbGlzdC5jcmVhdGVFbChcInVsXCIpO1xyXG4gICAgICBmb3IgKGxldCBmYWlsZWRfZmlsZSBvZiB0aGlzLnBsdWdpbi5zZXR0aW5ncy5mYWlsZWRfZmlsZXMpIHtcclxuICAgICAgICBsaXN0LmNyZWF0ZUVsKFwibGlcIiwge1xyXG4gICAgICAgICAgdGV4dDogZmFpbGVkX2ZpbGVcclxuICAgICAgICB9KTtcclxuICAgICAgfVxyXG4gICAgICAvLyBhZGQgYnV0dG9uIHRvIHJldHJ5IGZhaWxlZCBmaWxlcyBvbmx5XHJcbiAgICAgIG5ldyBPYnNpZGlhbi5TZXR0aW5nKGZhaWxlZF9saXN0KS5zZXROYW1lKFwiXHU0RUM1XHU5MUNEXHU4QkQ1XHU1OTMxXHU4RDI1XHU2NTg3XHU0RUY2XCIpLnNldERlc2MoXCJcdTRFQzVcdTkxQ0RcdThCRDVcdTU5MzFcdThEMjVcdTY1ODdcdTRFRjZcIikuYWRkQnV0dG9uKChidXR0b24pID0+IGJ1dHRvbi5zZXRCdXR0b25UZXh0KFwiXHU0RUM1XHU5MUNEXHU4QkQ1XHU1OTMxXHU4RDI1XHU2NTg3XHU0RUY2XCIpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgIC8vIGNsZWFyIGZhaWxlZF9saXN0IGVsZW1lbnRcclxuICAgICAgICBmYWlsZWRfbGlzdC5lbXB0eSgpO1xyXG4gICAgICAgIC8vIHNldCBcInJldHJ5aW5nXCIgdGV4dFxyXG4gICAgICAgIGZhaWxlZF9saXN0LmNyZWF0ZUVsKFwicFwiLCB7XHJcbiAgICAgICAgICB0ZXh0OiBcIlx1NkI2M1x1NTcyOFx1OTFDRFx1OEJENS4uLlwiXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4ucmV0cnlfZmFpbGVkX2ZpbGVzKCk7XHJcbiAgICAgICAgLy8gcmVkcmF3IGZhaWxlZCBmaWxlcyBsaXN0XHJcbiAgICAgICAgdGhpcy5kcmF3X2ZhaWxlZF9maWxlc19saXN0KGZhaWxlZF9saXN0KTtcclxuICAgICAgfSkpO1xyXG4gICAgfWVsc2V7XHJcbiAgICAgIGZhaWxlZF9saXN0LmNyZWF0ZUVsKFwicFwiLCB7XHJcbiAgICAgICAgdGV4dDogXCJcdTY1RTBcdTU5MDRcdTc0MDZcdTU5MzFcdThEMjVcdTc2ODRcdTY1ODdcdTRFRjZcIlxyXG4gICAgICB9KTtcclxuICAgIH1cclxuICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGxpbmVfaXNfaGVhZGluZyhsaW5lKSB7XHJcbiAgcmV0dXJuIChsaW5lLmluZGV4T2YoXCIjXCIpID09PSAwKSAmJiAoWycjJywgJyAnXS5pbmRleE9mKGxpbmVbMV0pICE9PSAtMSk7XHJcbn1cclxuXHJcbmNvbnN0IFNNQVJUX0NPTk5FQ1RJT05TX0NIQVRfVklFV19UWVBFID0gXCJzbWFydC1jb25uZWN0aW9ucy1jaGF0LXZpZXdcIjtcclxuXHJcbmNsYXNzIFNtYXJ0Q29ubmVjdGlvbnNDaGF0VmlldyBleHRlbmRzIE9ic2lkaWFuLkl0ZW1WaWV3IHtcclxuICBjb25zdHJ1Y3RvcihsZWFmLCBwbHVnaW4pIHtcclxuICAgIHN1cGVyKGxlYWYpO1xyXG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XHJcbiAgICB0aGlzLmFjdGl2ZV9lbG0gPSBudWxsO1xyXG4gICAgdGhpcy5hY3RpdmVfc3RyZWFtID0gbnVsbDtcclxuICAgIHRoaXMuYnJhY2tldHNfY3QgPSAwO1xyXG4gICAgdGhpcy5jaGF0ID0gbnVsbDtcclxuICAgIHRoaXMuY2hhdF9ib3ggPSBudWxsO1xyXG4gICAgdGhpcy5jaGF0X2NvbnRhaW5lciA9IG51bGw7XHJcbiAgICB0aGlzLmN1cnJlbnRfY2hhdF9tbCA9IFtdO1xyXG4gICAgdGhpcy5maWxlcyA9IFtdO1xyXG4gICAgdGhpcy5sYXN0X2Zyb20gPSBudWxsO1xyXG4gICAgdGhpcy5tZXNzYWdlX2NvbnRhaW5lciA9IG51bGw7XHJcbiAgICB0aGlzLnByZXZlbnRfaW5wdXQgPSBmYWxzZTtcclxuICB9XHJcbiAgZ2V0RGlzcGxheVRleHQoKSB7XHJcbiAgICByZXR1cm4gXCJTbWFydCBDb25uZWN0aW9ucyBDaGF0XCI7XHJcbiAgfVxyXG4gIGdldEljb24oKSB7XHJcbiAgICByZXR1cm4gXCJtZXNzYWdlLXNxdWFyZVwiO1xyXG4gIH1cclxuICBnZXRWaWV3VHlwZSgpIHtcclxuICAgIHJldHVybiBTTUFSVF9DT05ORUNUSU9OU19DSEFUX1ZJRVdfVFlQRTtcclxuICB9XHJcbiAgb25PcGVuKCkge1xyXG4gICAgdGhpcy5uZXdfY2hhdCgpO1xyXG4gICAgdGhpcy5wbHVnaW4uZ2V0X2FsbF9mb2xkZXJzKCk7IC8vIHNldHMgdGhpcy5wbHVnaW4uZm9sZGVycyBuZWNlc3NhcnkgZm9yIGZvbGRlci1jb250ZXh0XHJcbiAgfVxyXG4gIG9uQ2xvc2UoKSB7XHJcbiAgICB0aGlzLmNoYXQuc2F2ZV9jaGF0KCk7XHJcbiAgICB0aGlzLmFwcC53b3Jrc3BhY2UudW5yZWdpc3RlckhvdmVyTGlua1NvdXJjZShTTUFSVF9DT05ORUNUSU9OU19DSEFUX1ZJRVdfVFlQRSk7XHJcbiAgfVxyXG4gIHJlbmRlcl9jaGF0KCkge1xyXG4gICAgdGhpcy5jb250YWluZXJFbC5lbXB0eSgpO1xyXG4gICAgdGhpcy5jaGF0X2NvbnRhaW5lciA9IHRoaXMuY29udGFpbmVyRWwuY3JlYXRlRGl2KFwic2MtY2hhdC1jb250YWluZXJcIik7XHJcbiAgICAvLyByZW5kZXIgcGx1cyBzaWduIGZvciBjbGVhciBidXR0b25cclxuICAgIHRoaXMucmVuZGVyX3RvcF9iYXIoKTtcclxuICAgIC8vIHJlbmRlciBjaGF0IG1lc3NhZ2VzIGNvbnRhaW5lclxyXG4gICAgdGhpcy5yZW5kZXJfY2hhdF9ib3goKTtcclxuICAgIC8vIHJlbmRlciBjaGF0IGlucHV0XHJcbiAgICB0aGlzLnJlbmRlcl9jaGF0X2lucHV0KCk7XHJcbiAgICB0aGlzLnBsdWdpbi5yZW5kZXJfYnJhbmQodGhpcy5jb250YWluZXJFbCwgXCJjaGF0XCIpO1xyXG4gIH1cclxuICAvLyByZW5kZXIgcGx1cyBzaWduIGZvciBjbGVhciBidXR0b25cclxuICByZW5kZXJfdG9wX2JhcigpIHtcclxuICAgIC8vIGNyZWF0ZSBjb250YWluZXIgZm9yIGNsZWFyIGJ1dHRvblxyXG4gICAgbGV0IHRvcF9iYXJfY29udGFpbmVyID0gdGhpcy5jaGF0X2NvbnRhaW5lci5jcmVhdGVEaXYoXCJzYy10b3AtYmFyLWNvbnRhaW5lclwiKTtcclxuICAgIC8vIHJlbmRlciB0aGUgbmFtZSBvZiB0aGUgY2hhdCBpbiBhbiBpbnB1dCBib3ggKHBvcCBjb250ZW50IGFmdGVyIGxhc3QgaHlwaGVuIGluIGNoYXRfaWQpXHJcbiAgICBsZXQgY2hhdF9uYW1lID10aGlzLmNoYXQubmFtZSgpO1xyXG4gICAgbGV0IGNoYXRfbmFtZV9pbnB1dCA9IHRvcF9iYXJfY29udGFpbmVyLmNyZWF0ZUVsKFwiaW5wdXRcIiwge1xyXG4gICAgICBhdHRyOiB7XHJcbiAgICAgICAgdHlwZTogXCJ0ZXh0XCIsXHJcbiAgICAgICAgdmFsdWU6IGNoYXRfbmFtZVxyXG4gICAgICB9LFxyXG4gICAgICBjbHM6IFwic2MtY2hhdC1uYW1lLWlucHV0XCJcclxuICAgIH0pO1xyXG4gICAgY2hhdF9uYW1lX2lucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgdGhpcy5yZW5hbWVfY2hhdC5iaW5kKHRoaXMpKTtcclxuICAgIFxyXG4gICAgLy8gY3JlYXRlIGJ1dHRvbiB0byBTbWFydCBWaWV3XHJcbiAgICBsZXQgc21hcnRfdmlld19idG4gPSB0aGlzLmNyZWF0ZV90b3BfYmFyX2J1dHRvbih0b3BfYmFyX2NvbnRhaW5lciwgXCJTbWFydCBWaWV3XCIsIFwic21hcnQtY29ubmVjdGlvbnNcIik7XHJcbiAgICBzbWFydF92aWV3X2J0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgdGhpcy5vcGVuX3NtYXJ0X3ZpZXcuYmluZCh0aGlzKSk7XHJcbiAgICAvLyBjcmVhdGUgYnV0dG9uIHRvIHNhdmUgY2hhdFxyXG4gICAgbGV0IHNhdmVfYnRuID0gdGhpcy5jcmVhdGVfdG9wX2Jhcl9idXR0b24odG9wX2Jhcl9jb250YWluZXIsIFwiU2F2ZSBDaGF0XCIsIFwic2F2ZVwiKTtcclxuICAgIHNhdmVfYnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCB0aGlzLnNhdmVfY2hhdC5iaW5kKHRoaXMpKTtcclxuICAgIC8vIGNyZWF0ZSBidXR0b24gdG8gb3BlbiBjaGF0IGhpc3RvcnkgbW9kYWxcclxuICAgIGxldCBoaXN0b3J5X2J0biA9IHRoaXMuY3JlYXRlX3RvcF9iYXJfYnV0dG9uKHRvcF9iYXJfY29udGFpbmVyLCBcIkNoYXQgSGlzdG9yeVwiLCBcImhpc3RvcnlcIik7XHJcbiAgICBoaXN0b3J5X2J0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgdGhpcy5vcGVuX2NoYXRfaGlzdG9yeS5iaW5kKHRoaXMpKTtcclxuICAgIC8vIGNyZWF0ZSBidXR0b24gdG8gc3RhcnQgbmV3IGNoYXRcclxuICAgIGNvbnN0IG5ld19jaGF0X2J0biA9IHRoaXMuY3JlYXRlX3RvcF9iYXJfYnV0dG9uKHRvcF9iYXJfY29udGFpbmVyLCBcIk5ldyBDaGF0XCIsIFwicGx1c1wiKTtcclxuICAgIG5ld19jaGF0X2J0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgdGhpcy5uZXdfY2hhdC5iaW5kKHRoaXMpKTtcclxuICB9XHJcbiAgYXN5bmMgb3Blbl9jaGF0X2hpc3RvcnkoKSB7XHJcbiAgICBjb25zdCBmb2xkZXIgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLmxpc3QoXCIuc21hcnQtY29ubmVjdGlvbnMvY2hhdHNcIik7XHJcbiAgICB0aGlzLmZpbGVzID0gZm9sZGVyLmZpbGVzLm1hcCgoZmlsZSkgPT4ge1xyXG4gICAgICByZXR1cm4gZmlsZS5yZXBsYWNlKFwiLnNtYXJ0LWNvbm5lY3Rpb25zL2NoYXRzL1wiLCBcIlwiKS5yZXBsYWNlKFwiLmpzb25cIiwgXCJcIik7XHJcbiAgICB9KTtcclxuICAgIC8vIG9wZW4gY2hhdCBoaXN0b3J5IG1vZGFsXHJcbiAgICBpZiAoIXRoaXMubW9kYWwpXHJcbiAgICAgIHRoaXMubW9kYWwgPSBuZXcgU21hcnRDb25uZWN0aW9uc0NoYXRIaXN0b3J5TW9kYWwodGhpcy5hcHAsIHRoaXMpO1xyXG4gICAgdGhpcy5tb2RhbC5vcGVuKCk7XHJcbiAgfVxyXG5cclxuICBjcmVhdGVfdG9wX2Jhcl9idXR0b24odG9wX2Jhcl9jb250YWluZXIsIHRpdGxlLCBpY29uPW51bGwpIHtcclxuICAgIGxldCBidG4gPSB0b3BfYmFyX2NvbnRhaW5lci5jcmVhdGVFbChcImJ1dHRvblwiLCB7XHJcbiAgICAgIGF0dHI6IHtcclxuICAgICAgICB0aXRsZTogdGl0bGVcclxuICAgICAgfVxyXG4gICAgfSk7XHJcbiAgICBpZihpY29uKXtcclxuICAgICAgT2JzaWRpYW4uc2V0SWNvbihidG4sIGljb24pO1xyXG4gICAgfWVsc2V7XHJcbiAgICAgIGJ0bi5pbm5lckhUTUwgPSB0aXRsZTtcclxuICAgIH1cclxuICAgIHJldHVybiBidG47XHJcbiAgfVxyXG4gIC8vIHJlbmRlciBuZXcgY2hhdFxyXG4gIG5ld19jaGF0KCkge1xyXG4gICAgdGhpcy5jbGVhcl9jaGF0KCk7XHJcbiAgICB0aGlzLnJlbmRlcl9jaGF0KCk7XHJcbiAgICAvLyByZW5kZXIgaW5pdGlhbCBtZXNzYWdlIGZyb20gYXNzaXN0YW50IChkb24ndCB1c2UgcmVuZGVyX21lc3NhZ2UgdG8gc2tpcCBhZGRpbmcgdG8gY2hhdCBoaXN0b3J5KVxyXG4gICAgdGhpcy5uZXdfbWVzc3NhZ2VfYnViYmxlKFwiYXNzaXN0YW50XCIpO1xyXG4gICAgdGhpcy5hY3RpdmVfZWxtLmlubmVySFRNTCA9ICc8cD4nICsgU01BUlRfVFJBTlNMQVRJT05bdGhpcy5wbHVnaW4uc2V0dGluZ3MubGFuZ3VhZ2VdLmluaXRpYWxfbWVzc2FnZSsnPC9wPic7XHJcbiAgfVxyXG4gIC8vIG9wZW4gYSBjaGF0IGZyb20gdGhlIGNoYXQgaGlzdG9yeSBtb2RhbFxyXG4gIGFzeW5jIG9wZW5fY2hhdChjaGF0X2lkKSB7XHJcbiAgICB0aGlzLmNsZWFyX2NoYXQoKTtcclxuICAgIGF3YWl0IHRoaXMuY2hhdC5sb2FkX2NoYXQoY2hhdF9pZCk7XHJcbiAgICB0aGlzLnJlbmRlcl9jaGF0KCk7XHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMuY2hhdC5jaGF0X21sLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyX21lc3NhZ2UodGhpcy5jaGF0LmNoYXRfbWxbaV0uY29udGVudCwgdGhpcy5jaGF0LmNoYXRfbWxbaV0ucm9sZSk7XHJcbiAgICB9XHJcbiAgfVxyXG4gIC8vIGNsZWFyIGN1cnJlbnQgY2hhdCBzdGF0ZVxyXG4gIGNsZWFyX2NoYXQoKSB7XHJcbiAgICBpZiAodGhpcy5jaGF0KSB7XHJcbiAgICAgIHRoaXMuY2hhdC5zYXZlX2NoYXQoKTtcclxuICAgIH1cclxuICAgIHRoaXMuY2hhdCA9IG5ldyBTbWFydENvbm5lY3Rpb25zQ2hhdE1vZGVsKHRoaXMucGx1Z2luKTtcclxuICAgIC8vIGlmIHRoaXMuZG90ZG90ZG90X2ludGVydmFsIGlzIG5vdCBudWxsLCBjbGVhciBpbnRlcnZhbFxyXG4gICAgaWYgKHRoaXMuZG90ZG90ZG90X2ludGVydmFsKSB7XHJcbiAgICAgIGNsZWFySW50ZXJ2YWwodGhpcy5kb3Rkb3Rkb3RfaW50ZXJ2YWwpO1xyXG4gICAgfVxyXG4gICAgLy8gY2xlYXIgY3VycmVudCBjaGF0IG1sXHJcbiAgICB0aGlzLmN1cnJlbnRfY2hhdF9tbCA9IFtdO1xyXG4gICAgLy8gdXBkYXRlIHByZXZlbnQgaW5wdXRcclxuICAgIHRoaXMuZW5kX3N0cmVhbSgpO1xyXG4gIH1cclxuXHJcbiAgcmVuYW1lX2NoYXQoZXZlbnQpIHtcclxuICAgIGxldCBuZXdfY2hhdF9uYW1lID0gZXZlbnQudGFyZ2V0LnZhbHVlO1xyXG4gICAgdGhpcy5jaGF0LnJlbmFtZV9jaGF0KG5ld19jaGF0X25hbWUpO1xyXG4gIH1cclxuICBcclxuICAvLyBzYXZlIGN1cnJlbnQgY2hhdFxyXG4gIHNhdmVfY2hhdCgpIHtcclxuICAgIHRoaXMuY2hhdC5zYXZlX2NoYXQoKTtcclxuICAgIG5ldyBPYnNpZGlhbi5Ob3RpY2UoXCJbU21hcnQgQ29ubmVjdGlvbnNdIENoYXQgc2F2ZWRcIik7XHJcbiAgfVxyXG4gIFxyXG4gIG9wZW5fc21hcnRfdmlldygpIHtcclxuICAgIHRoaXMucGx1Z2luLm9wZW5fdmlldygpO1xyXG4gIH1cclxuICAvLyByZW5kZXIgY2hhdCBtZXNzYWdlcyBjb250YWluZXJcclxuICByZW5kZXJfY2hhdF9ib3goKSB7XHJcbiAgICAvLyBjcmVhdGUgY29udGFpbmVyIGZvciBjaGF0IG1lc3NhZ2VzXHJcbiAgICB0aGlzLmNoYXRfYm94ID0gdGhpcy5jaGF0X2NvbnRhaW5lci5jcmVhdGVEaXYoXCJzYy1jaGF0LWJveFwiKTtcclxuICAgIC8vIGNyZWF0ZSBjb250YWluZXIgZm9yIG1lc3NhZ2VcclxuICAgIHRoaXMubWVzc2FnZV9jb250YWluZXIgPSB0aGlzLmNoYXRfYm94LmNyZWF0ZURpdihcInNjLW1lc3NhZ2UtY29udGFpbmVyXCIpO1xyXG4gIH1cclxuICAvLyBvcGVuIGZpbGUgc3VnZ2VzdGlvbiBtb2RhbFxyXG4gIG9wZW5fZmlsZV9zdWdnZXN0aW9uX21vZGFsKCkge1xyXG4gICAgLy8gb3BlbiBmaWxlIHN1Z2dlc3Rpb24gbW9kYWxcclxuICAgIGlmKCF0aGlzLmZpbGVfc2VsZWN0b3IpIHRoaXMuZmlsZV9zZWxlY3RvciA9IG5ldyBTbWFydENvbm5lY3Rpb25zRmlsZVNlbGVjdE1vZGFsKHRoaXMuYXBwLCB0aGlzKTtcclxuICAgIHRoaXMuZmlsZV9zZWxlY3Rvci5vcGVuKCk7XHJcbiAgfVxyXG4gIC8vIG9wZW4gZm9sZGVyIHN1Z2dlc3Rpb24gbW9kYWxcclxuICBhc3luYyBvcGVuX2ZvbGRlcl9zdWdnZXN0aW9uX21vZGFsKCkge1xyXG4gICAgLy8gb3BlbiBmb2xkZXIgc3VnZ2VzdGlvbiBtb2RhbFxyXG4gICAgaWYoIXRoaXMuZm9sZGVyX3NlbGVjdG9yKXtcclxuICAgICAgdGhpcy5mb2xkZXJfc2VsZWN0b3IgPSBuZXcgU21hcnRDb25uZWN0aW9uc0ZvbGRlclNlbGVjdE1vZGFsKHRoaXMuYXBwLCB0aGlzKTtcclxuICAgIH1cclxuICAgIHRoaXMuZm9sZGVyX3NlbGVjdG9yLm9wZW4oKTtcclxuICB9XHJcbiAgLy8gaW5zZXJ0X3NlbGVjdGlvbiBmcm9tIGZpbGUgc3VnZ2VzdGlvbiBtb2RhbFxyXG4gIGluc2VydF9zZWxlY3Rpb24oaW5zZXJ0X3RleHQpIHtcclxuICAgIC8vIGdldCBjYXJldCBwb3NpdGlvblxyXG4gICAgbGV0IGNhcmV0X3BvcyA9IHRoaXMudGV4dGFyZWEuc2VsZWN0aW9uU3RhcnQ7XHJcbiAgICAvLyBnZXQgdGV4dCBiZWZvcmUgY2FyZXRcclxuICAgIGxldCB0ZXh0X2JlZm9yZSA9IHRoaXMudGV4dGFyZWEudmFsdWUuc3Vic3RyaW5nKDAsIGNhcmV0X3Bvcyk7XHJcbiAgICAvLyBnZXQgdGV4dCBhZnRlciBjYXJldFxyXG4gICAgbGV0IHRleHRfYWZ0ZXIgPSB0aGlzLnRleHRhcmVhLnZhbHVlLnN1YnN0cmluZyhjYXJldF9wb3MsIHRoaXMudGV4dGFyZWEudmFsdWUubGVuZ3RoKTtcclxuICAgIC8vIGluc2VydCB0ZXh0XHJcbiAgICB0aGlzLnRleHRhcmVhLnZhbHVlID0gdGV4dF9iZWZvcmUgKyBpbnNlcnRfdGV4dCArIHRleHRfYWZ0ZXI7XHJcbiAgICAvLyBzZXQgY2FyZXQgcG9zaXRpb25cclxuICAgIHRoaXMudGV4dGFyZWEuc2VsZWN0aW9uU3RhcnQgPSBjYXJldF9wb3MgKyBpbnNlcnRfdGV4dC5sZW5ndGg7XHJcbiAgICB0aGlzLnRleHRhcmVhLnNlbGVjdGlvbkVuZCA9IGNhcmV0X3BvcyArIGluc2VydF90ZXh0Lmxlbmd0aDtcclxuICAgIC8vIGZvY3VzIG9uIHRleHRhcmVhXHJcbiAgICB0aGlzLnRleHRhcmVhLmZvY3VzKCk7XHJcbiAgfVxyXG5cclxuICAvLyByZW5kZXIgY2hhdCB0ZXh0YXJlYSBhbmQgYnV0dG9uXHJcbiAgcmVuZGVyX2NoYXRfaW5wdXQoKSB7XHJcbiAgICAvLyBjcmVhdGUgY29udGFpbmVyIGZvciBjaGF0IGlucHV0XHJcbiAgICBsZXQgY2hhdF9pbnB1dCA9IHRoaXMuY2hhdF9jb250YWluZXIuY3JlYXRlRGl2KFwic2MtY2hhdC1mb3JtXCIpO1xyXG4gICAgLy8gY3JlYXRlIHRleHRhcmVhXHJcbiAgICB0aGlzLnRleHRhcmVhID0gY2hhdF9pbnB1dC5jcmVhdGVFbChcInRleHRhcmVhXCIsIHtcclxuICAgICAgY2xzOiBcInNjLWNoYXQtaW5wdXRcIixcclxuICAgICAgYXR0cjoge1xyXG4gICAgICAgIHBsYWNlaG9sZGVyOiBgXHU0RjdGXHU3NTI4IFx1MjAxQ1x1NTdGQVx1NEU4RVx1NjIxMVx1NzY4NFx1N0IxNFx1OEJCMFx1MjAxRCBcdTYyMTYgXHUyMDFDXHU2MDNCXHU3RUQzIFtbT2JzaWRpYW4gXHU5NEZFXHU2M0E1XV1cdTIwMUQgXHU2MjE2IFwiXHU1NDRBXHU4QkM5XHU2MjExIC9cdTc2RUVcdTVGNTUvIFx1NEUyRFx1NjcwOVx1NEVDMFx1NEU0OFx1OTFDRFx1ODk4MVx1NEZFMVx1NjA2RlwiYFxyXG4gICAgICB9XHJcbiAgICB9KTtcclxuICAgIC8vIHVzZSBjb250ZW50ZWRpdGFibGUgaW5zdGVhZCBvZiB0ZXh0YXJlYVxyXG4gICAgLy8gdGhpcy50ZXh0YXJlYSA9IGNoYXRfaW5wdXQuY3JlYXRlRWwoXCJkaXZcIiwge2NsczogXCJzYy1jaGF0LWlucHV0XCIsIGF0dHI6IHtjb250ZW50ZWRpdGFibGU6IHRydWV9fSk7XHJcbiAgICAvLyBhZGQgZXZlbnQgbGlzdGVuZXIgdG8gbGlzdGVuIGZvciBzaGlmdCtlbnRlclxyXG4gICAgY2hhdF9pbnB1dC5hZGRFdmVudExpc3RlbmVyKFwia2V5dXBcIiwgKGUpID0+IHtcclxuICAgICAgaWYoW1wiW1wiLCBcIi9cIl0uaW5kZXhPZihlLmtleSkgPT09IC0xKSByZXR1cm47IC8vIHNraXAgaWYga2V5IGlzIG5vdCBbIG9yIC9cclxuICAgICAgY29uc3QgY2FyZXRfcG9zID0gdGhpcy50ZXh0YXJlYS5zZWxlY3Rpb25TdGFydDtcclxuICAgICAgLy8gaWYga2V5IGlzIG9wZW4gc3F1YXJlIGJyYWNrZXRcclxuICAgICAgaWYgKGUua2V5ID09PSBcIltcIikge1xyXG4gICAgICAgIC8vIGlmIHByZXZpb3VzIGNoYXIgaXMgW1xyXG4gICAgICAgIGlmKHRoaXMudGV4dGFyZWEudmFsdWVbY2FyZXRfcG9zIC0gMl0gPT09IFwiW1wiKXtcclxuICAgICAgICAgIC8vIG9wZW4gZmlsZSBzdWdnZXN0aW9uIG1vZGFsXHJcbiAgICAgICAgICB0aGlzLm9wZW5fZmlsZV9zdWdnZXN0aW9uX21vZGFsKCk7XHJcbiAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICB9ZWxzZXtcclxuICAgICAgICB0aGlzLmJyYWNrZXRzX2N0ID0gMDtcclxuICAgICAgfVxyXG4gICAgICAvLyBpZiAvIGlzIHByZXNzZWRcclxuICAgICAgaWYgKGUua2V5ID09PSBcIi9cIikge1xyXG4gICAgICAgIC8vIGdldCBjYXJldCBwb3NpdGlvblxyXG4gICAgICAgIC8vIGlmIHRoaXMgaXMgZmlyc3QgY2hhciBvciBwcmV2aW91cyBjaGFyIGlzIHNwYWNlXHJcbiAgICAgICAgaWYgKHRoaXMudGV4dGFyZWEudmFsdWUubGVuZ3RoID09PSAxIHx8IHRoaXMudGV4dGFyZWEudmFsdWVbY2FyZXRfcG9zIC0gMl0gPT09IFwiIFwiKSB7XHJcbiAgICAgICAgICAvLyBvcGVuIGZvbGRlciBzdWdnZXN0aW9uIG1vZGFsXHJcbiAgICAgICAgICB0aGlzLm9wZW5fZm9sZGVyX3N1Z2dlc3Rpb25fbW9kYWwoKTtcclxuICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuXHJcbiAgICB9KTtcclxuXHJcbiAgICBjaGF0X2lucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIChlKSA9PiB7XHJcbiAgICAgIGlmIChlLmtleSA9PT0gXCJFbnRlclwiICYmIGUuc2hpZnRLZXkpIHtcclxuICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgaWYodGhpcy5wcmV2ZW50X2lucHV0KXtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKFwid2FpdCB1bnRpbCBjdXJyZW50IHJlc3BvbnNlIGlzIGZpbmlzaGVkXCIpO1xyXG4gICAgICAgICAgbmV3IE9ic2lkaWFuLk5vdGljZShcIltTbWFydCBDb25uZWN0aW9uc10gV2FpdCB1bnRpbCBjdXJyZW50IHJlc3BvbnNlIGlzIGZpbmlzaGVkXCIpO1xyXG4gICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICAvLyBnZXQgdGV4dCBmcm9tIHRleHRhcmVhXHJcbiAgICAgICAgbGV0IHVzZXJfaW5wdXQgPSB0aGlzLnRleHRhcmVhLnZhbHVlO1xyXG4gICAgICAgIC8vIGNsZWFyIHRleHRhcmVhXHJcbiAgICAgICAgdGhpcy50ZXh0YXJlYS52YWx1ZSA9IFwiXCI7XHJcbiAgICAgICAgLy8gaW5pdGlhdGUgcmVzcG9uc2UgZnJvbSBhc3Npc3RhbnRcclxuICAgICAgICB0aGlzLmluaXRpYWxpemVfcmVzcG9uc2UodXNlcl9pbnB1dCk7XHJcbiAgICAgIH1cclxuICAgICAgdGhpcy50ZXh0YXJlYS5zdHlsZS5oZWlnaHQgPSAnYXV0byc7XHJcbiAgICAgIHRoaXMudGV4dGFyZWEuc3R5bGUuaGVpZ2h0ID0gKHRoaXMudGV4dGFyZWEuc2Nyb2xsSGVpZ2h0KSArICdweCc7XHJcbiAgICB9KTtcclxuICAgIC8vIGJ1dHRvbiBjb250YWluZXJcclxuICAgIGxldCBidXR0b25fY29udGFpbmVyID0gY2hhdF9pbnB1dC5jcmVhdGVEaXYoXCJzYy1idXR0b24tY29udGFpbmVyXCIpO1xyXG4gICAgLy8gY3JlYXRlIGhpZGRlbiBhYm9ydCBidXR0b25cclxuICAgIGxldCBhYm9ydF9idXR0b24gPSBidXR0b25fY29udGFpbmVyLmNyZWF0ZUVsKFwic3BhblwiLCB7IGF0dHI6IHtpZDogXCJzYy1hYm9ydC1idXR0b25cIiwgc3R5bGU6IFwiZGlzcGxheTogbm9uZTtcIn0gfSk7XHJcbiAgICBPYnNpZGlhbi5zZXRJY29uKGFib3J0X2J1dHRvbiwgXCJzcXVhcmVcIik7XHJcbiAgICAvLyBhZGQgZXZlbnQgbGlzdGVuZXIgdG8gYnV0dG9uXHJcbiAgICBhYm9ydF9idXR0b24uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcclxuICAgICAgLy8gYWJvcnQgY3VycmVudCByZXNwb25zZVxyXG4gICAgICB0aGlzLmVuZF9zdHJlYW0oKTtcclxuICAgIH0pO1xyXG4gICAgLy8gY3JlYXRlIGJ1dHRvblxyXG4gICAgbGV0IGJ1dHRvbiA9IGJ1dHRvbl9jb250YWluZXIuY3JlYXRlRWwoXCJidXR0b25cIiwgeyBhdHRyOiB7aWQ6IFwic2Mtc2VuZC1idXR0b25cIn0sIGNsczogXCJzZW5kLWJ1dHRvblwiIH0pO1xyXG4gICAgYnV0dG9uLmlubmVySFRNTCA9IFwiXHU1M0QxXHU5MDAxXCI7XHJcbiAgICAvLyBhZGQgZXZlbnQgbGlzdGVuZXIgdG8gYnV0dG9uXHJcbiAgICBidXR0b24uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcclxuICAgICAgaWYodGhpcy5wcmV2ZW50X2lucHV0KXtcclxuICAgICAgICBjb25zb2xlLmxvZyhcIndhaXQgdW50aWwgY3VycmVudCByZXNwb25zZSBpcyBmaW5pc2hlZFwiKTtcclxuICAgICAgICBuZXcgT2JzaWRpYW4uTm90aWNlKFwiXHU4QkY3XHU3QjQ5XHU1Rjg1XHU1RjUzXHU1MjREXHU1NkRFXHU1OTBEXHU3RUQzXHU2NzVGXCIpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG4gICAgICAvLyBnZXQgdGV4dCBmcm9tIHRleHRhcmVhXHJcbiAgICAgIGxldCB1c2VyX2lucHV0ID0gdGhpcy50ZXh0YXJlYS52YWx1ZTtcclxuICAgICAgLy8gY2xlYXIgdGV4dGFyZWFcclxuICAgICAgdGhpcy50ZXh0YXJlYS52YWx1ZSA9IFwiXCI7XHJcbiAgICAgIC8vIGluaXRpYXRlIHJlc3BvbnNlIGZyb20gYXNzaXN0YW50XHJcbiAgICAgIHRoaXMuaW5pdGlhbGl6ZV9yZXNwb25zZSh1c2VyX2lucHV0KTtcclxuICAgIH0pO1xyXG4gIH1cclxuICBhc3luYyBpbml0aWFsaXplX3Jlc3BvbnNlKHVzZXJfaW5wdXQpIHtcclxuICAgIHRoaXMuc2V0X3N0cmVhbWluZ191eCgpO1xyXG4gICAgLy8gcmVuZGVyIG1lc3NhZ2VcclxuICAgIGF3YWl0IHRoaXMucmVuZGVyX21lc3NhZ2UodXNlcl9pbnB1dCwgXCJ1c2VyXCIpO1xyXG4gICAgdGhpcy5jaGF0Lm5ld19tZXNzYWdlX2luX3RocmVhZCh7XHJcbiAgICAgIHJvbGU6IFwidXNlclwiLFxyXG4gICAgICBjb250ZW50OiB1c2VyX2lucHV0XHJcbiAgICB9KTtcclxuICAgIGF3YWl0IHRoaXMucmVuZGVyX2RvdGRvdGRvdCgpO1xyXG5cclxuICAgIC8vIGlmIGNvbnRhaW5zIGludGVybmFsIGxpbmsgcmVwcmVzZW50ZWQgYnkgW1tsaW5rXV1cclxuICAgIGlmKHRoaXMuY2hhdC5jb250YWluc19pbnRlcm5hbF9saW5rKHVzZXJfaW5wdXQpKSB7XHJcbiAgICAgIHRoaXMuY2hhdC5nZXRfcmVzcG9uc2Vfd2l0aF9ub3RlX2NvbnRleHQodXNlcl9pbnB1dCwgdGhpcyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIC8vIC8vIGZvciB0ZXN0aW5nIHB1cnBvc2VzXHJcbiAgICAvLyBpZih0aGlzLmNoYXQuY29udGFpbnNfZm9sZGVyX3JlZmVyZW5jZSh1c2VyX2lucHV0KSkge1xyXG4gICAgLy8gICBjb25zdCBmb2xkZXJzID0gdGhpcy5jaGF0LmdldF9mb2xkZXJfcmVmZXJlbmNlcyh1c2VyX2lucHV0KTtcclxuICAgIC8vICAgY29uc29sZS5sb2coZm9sZGVycyk7XHJcbiAgICAvLyAgIHJldHVybjtcclxuICAgIC8vIH1cclxuICAgIC8vIGlmIGNvbnRhaW5zIHNlbGYgcmVmZXJlbnRpYWwga2V5d29yZHMgb3IgZm9sZGVyIHJlZmVyZW5jZVxyXG5cclxuICAgIGlmKHRoaXMuY29udGFpbnNfc2VsZl9yZWZlcmVudGlhbF9rZXl3b3Jkcyh1c2VyX2lucHV0KSB8fCB0aGlzLmNoYXQuY29udGFpbnNfZm9sZGVyX3JlZmVyZW5jZSh1c2VyX2lucHV0KSkge1xyXG4gICAgICAvLyBnZXQgaHlkZVxyXG4gICAgICBjb25zdCBjb250ZXh0ID0gYXdhaXQgdGhpcy5nZXRfY29udGV4dF9oeWRlKHVzZXJfaW5wdXQpO1xyXG4gICAgICAvLyBnZXQgdXNlciBpbnB1dCB3aXRoIGFkZGVkIGNvbnRleHRcclxuICAgICAgLy8gY29uc3QgY29udGV4dF9pbnB1dCA9IHRoaXMuYnVpbGRfY29udGV4dF9pbnB1dChjb250ZXh0KTtcclxuICAgICAgLy8gY29uc29sZS5sb2coY29udGV4dF9pbnB1dCk7XHJcbiAgICAgIGNvbnN0IGNoYXRtbCA9IFtcclxuICAgICAgICB7XHJcbiAgICAgICAgICByb2xlOiBcInN5c3RlbVwiLFxyXG4gICAgICAgICAgLy8gY29udGVudDogY29udGV4dF9pbnB1dFxyXG4gICAgICAgICAgY29udGVudDogY29udGV4dFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgcm9sZTogXCJ1c2VyXCIsXHJcbiAgICAgICAgICBjb250ZW50OiB1c2VyX2lucHV0XHJcbiAgICAgICAgfVxyXG4gICAgICBdO1xyXG4gICAgICB0aGlzLnJlcXVlc3RfY2hhdGdwdF9jb21wbGV0aW9uKHttZXNzYWdlczogY2hhdG1sLCB0ZW1wZXJhdHVyZTogMCwgcHJpdmFjeVN0cjogJ1x1NURGMlx1N0VDRlx1OEJGQlx1NTNENlx1N0IxNFx1OEJCMFx1NTE4NVx1NUJCOSd9KTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgLy8gY29tcGxldGlvbiB3aXRob3V0IGFueSBzcGVjaWZpYyBjb250ZXh0XHJcbiAgICB0aGlzLnJlcXVlc3RfY2hhdGdwdF9jb21wbGV0aW9uKCk7XHJcbiAgfVxyXG4gIFxyXG4gIGFzeW5jIHJlbmRlcl9kb3Rkb3Rkb3QoKSB7XHJcbiAgICBpZiAodGhpcy5kb3Rkb3Rkb3RfaW50ZXJ2YWwpXHJcbiAgICAgIGNsZWFySW50ZXJ2YWwodGhpcy5kb3Rkb3Rkb3RfaW50ZXJ2YWwpO1xyXG4gICAgYXdhaXQgdGhpcy5yZW5kZXJfbWVzc2FnZShcIi4uLlwiLCBcImFzc2lzdGFudFwiKTtcclxuICAgIC8vIGlmIGlzICcuLi4nLCB0aGVuIGluaXRpYXRlIGludGVydmFsIHRvIGNoYW5nZSB0byAnLicgYW5kIHRoZW4gdG8gJy4uJyBhbmQgdGhlbiB0byAnLi4uJ1xyXG4gICAgbGV0IGRvdHMgPSAwO1xyXG4gICAgdGhpcy5hY3RpdmVfZWxtLmlubmVySFRNTCA9ICcuLi4nO1xyXG4gICAgdGhpcy5kb3Rkb3Rkb3RfaW50ZXJ2YWwgPSBzZXRJbnRlcnZhbCgoKSA9PiB7XHJcbiAgICAgIGRvdHMrKztcclxuICAgICAgaWYgKGRvdHMgPiAzKVxyXG4gICAgICAgIGRvdHMgPSAxO1xyXG4gICAgICB0aGlzLmFjdGl2ZV9lbG0uaW5uZXJIVE1MID0gJy4nLnJlcGVhdChkb3RzKTtcclxuICAgIH0sIDUwMCk7XHJcbiAgICAvLyB3YWl0IDIgc2Vjb25kcyBmb3IgdGVzdGluZ1xyXG4gICAgLy8gYXdhaXQgbmV3IFByb21pc2UociA9PiBzZXRUaW1lb3V0KHIsIDIwMDApKTtcclxuICB9XHJcblxyXG4gIHNldF9zdHJlYW1pbmdfdXgoKSB7XHJcbiAgICB0aGlzLnByZXZlbnRfaW5wdXQgPSB0cnVlO1xyXG4gICAgLy8gaGlkZSBzZW5kIGJ1dHRvblxyXG4gICAgaWYoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXCJzYy1zZW5kLWJ1dHRvblwiKSlcclxuICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXCJzYy1zZW5kLWJ1dHRvblwiKS5zdHlsZS5kaXNwbGF5ID0gXCJub25lXCI7XHJcbiAgICAvLyBzaG93IGFib3J0IGJ1dHRvblxyXG4gICAgaWYoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXCJzYy1hYm9ydC1idXR0b25cIikpXHJcbiAgICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKFwic2MtYWJvcnQtYnV0dG9uXCIpLnN0eWxlLmRpc3BsYXkgPSBcImJsb2NrXCI7XHJcbiAgfVxyXG4gIHVuc2V0X3N0cmVhbWluZ191eCgpIHtcclxuICAgIHRoaXMucHJldmVudF9pbnB1dCA9IGZhbHNlO1xyXG4gICAgLy8gc2hvdyBzZW5kIGJ1dHRvbiwgcmVtb3ZlIGRpc3BsYXkgbm9uZVxyXG4gICAgaWYoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXCJzYy1zZW5kLWJ1dHRvblwiKSlcclxuICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXCJzYy1zZW5kLWJ1dHRvblwiKS5zdHlsZS5kaXNwbGF5ID0gXCJcIjtcclxuICAgIC8vIGhpZGUgYWJvcnQgYnV0dG9uXHJcbiAgICBpZihkb2N1bWVudC5nZXRFbGVtZW50QnlJZChcInNjLWFib3J0LWJ1dHRvblwiKSlcclxuICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXCJzYy1hYm9ydC1idXR0b25cIikuc3R5bGUuZGlzcGxheSA9IFwibm9uZVwiO1xyXG4gIH1cclxuXHJcblxyXG4gIC8vIGNoZWNrIGlmIGluY2x1ZGVzIGtleXdvcmRzIHJlZmVycmluZyB0byBvbmUncyBvd24gbm90ZXNcclxuICBjb250YWluc19zZWxmX3JlZmVyZW50aWFsX2tleXdvcmRzKHVzZXJfaW5wdXQpIHtcclxuICAgIGNvbnN0IG1hdGNoZXMgPSB1c2VyX2lucHV0Lm1hdGNoKC9cdTU3RkFcdTRFOEVcXHMqXHU2MjExXHU3Njg0XFxzKlx1N0IxNFx1OEJCMC8pO1xyXG4gICAgcmV0dXJuICEhbWF0Y2hlcztcclxuICB9XHJcblxyXG4gIC8vIHJlbmRlciBtZXNzYWdlXHJcbiAgYXN5bmMgcmVuZGVyX21lc3NhZ2UobWVzc2FnZSwgZnJvbT1cImFzc2lzdGFudFwiLCBhcHBlbmRfbGFzdD1mYWxzZSwgcHJpdmFjeVN0cj0nJykge1xyXG4gICAgLy8gaWYgZG90ZG90ZG90IGludGVydmFsIGlzIHNldCwgdGhlbiBjbGVhciBpdFxyXG4gICAgaWYodGhpcy5kb3Rkb3Rkb3RfaW50ZXJ2YWwpIHtcclxuICAgICAgY2xlYXJJbnRlcnZhbCh0aGlzLmRvdGRvdGRvdF9pbnRlcnZhbCk7XHJcbiAgICAgIHRoaXMuZG90ZG90ZG90X2ludGVydmFsID0gbnVsbDtcclxuICAgICAgLy8gY2xlYXIgbGFzdCBtZXNzYWdlXHJcbiAgICAgIHRoaXMuYWN0aXZlX2VsbS5pbm5lckhUTUwgPSAnJztcclxuICAgIH1cclxuICAgIGlmKGFwcGVuZF9sYXN0KSB7XHJcbiAgICAgIHRoaXMuY3VycmVudF9tZXNzYWdlX3JhdyArPSBtZXNzYWdlO1xyXG4gICAgICBpZihtZXNzYWdlLmluZGV4T2YoJ1xcbicpID09PSAtMSkge1xyXG4gICAgICAgIHRoaXMuYWN0aXZlX2VsbS5pbm5lckhUTUwgKz0gbWVzc2FnZTtcclxuICAgICAgfWVsc2V7XHJcbiAgICAgICAgdGhpcy5hY3RpdmVfZWxtLmlubmVySFRNTCA9ICcnO1xyXG4gICAgICAgIC8vIGFwcGVuZCB0byBsYXN0IG1lc3NhZ2VcclxuICAgICAgICBhd2FpdCBPYnNpZGlhbi5NYXJrZG93blJlbmRlcmVyLnJlbmRlck1hcmtkb3duKHRoaXMuY3VycmVudF9tZXNzYWdlX3JhdywgdGhpcy5hY3RpdmVfZWxtLCAnP25vLWRhdGF2aWV3JywgbmV3IE9ic2lkaWFuLkNvbXBvbmVudCgpKTtcclxuICAgICAgfVxyXG4gICAgfWVsc2V7XHJcbiAgICAgIHRoaXMuY3VycmVudF9tZXNzYWdlX3JhdyA9ICcnO1xyXG4gICAgICBpZigodGhpcy5jaGF0LnRocmVhZC5sZW5ndGggPT09IDApIHx8ICh0aGlzLmxhc3RfZnJvbSAhPT0gZnJvbSkpIHtcclxuICAgICAgICAvLyBjcmVhdGUgbWVzc2FnZVxyXG4gICAgICAgIHRoaXMubmV3X21lc3NzYWdlX2J1YmJsZShmcm9tKTtcclxuICAgICAgfVxyXG4gICAgICAvLyBzZXQgbWVzc2FnZSB0ZXh0XHJcbiAgICAgIHRoaXMuYWN0aXZlX2VsbS5pbm5lckhUTUwgPSAnJztcclxuICAgICAgaWYoZnJvbSA9PT0gJ2Fzc2lzdGFudCcgJiYgcHJpdmFjeVN0ciAhPT0gJycpIHtcclxuICAgICAgICB0aGlzLmFjdGl2ZV9lbG0uaW5uZXJIVE1MID0gYFske3ByaXZhY3lTdHJ9XWA7XHJcbiAgICAgIH1cclxuICAgICAgYXdhaXQgT2JzaWRpYW4uTWFya2Rvd25SZW5kZXJlci5yZW5kZXJNYXJrZG93bihtZXNzYWdlLCB0aGlzLmFjdGl2ZV9lbG0sICc/bm8tZGF0YXZpZXcnLCBuZXcgT2JzaWRpYW4uQ29tcG9uZW50KCkpO1xyXG4gICAgICAvLyBnZXQgbGlua3NcclxuICAgICAgdGhpcy5oYW5kbGVfbGlua3NfaW5fbWVzc2FnZSgpO1xyXG4gICAgICAvLyByZW5kZXIgYnV0dG9uKHMpXHJcbiAgICAgIHRoaXMucmVuZGVyX21lc3NhZ2VfYWN0aW9uX2J1dHRvbnMobWVzc2FnZSk7XHJcbiAgICB9XHJcbiAgICAvLyBzY3JvbGwgdG8gYm90dG9tXHJcbiAgICB0aGlzLm1lc3NhZ2VfY29udGFpbmVyLnNjcm9sbFRvcCA9IHRoaXMubWVzc2FnZV9jb250YWluZXIuc2Nyb2xsSGVpZ2h0O1xyXG4gIH1cclxuICByZW5kZXJfbWVzc2FnZV9hY3Rpb25fYnV0dG9ucyhtZXNzYWdlKSB7XHJcbiAgICBpZiAodGhpcy5jaGF0LmNvbnRleHQgJiYgdGhpcy5jaGF0Lmh5ZCkge1xyXG4gICAgICAvLyByZW5kZXIgYnV0dG9uIHRvIGNvcHkgaHlkIGluIHNtYXJ0LWNvbm5lY3Rpb25zIGNvZGUgYmxvY2tcclxuICAgICAgY29uc3QgY29udGV4dF92aWV3ID0gdGhpcy5hY3RpdmVfZWxtLmNyZWF0ZUVsKFwic3BhblwiLCB7XHJcbiAgICAgICAgY2xzOiBcInNjLW1zZy1idXR0b25cIixcclxuICAgICAgICBhdHRyOiB7XHJcbiAgICAgICAgICB0aXRsZTogXCJDb3B5IGNvbnRleHQgdG8gY2xpcGJvYXJkXCIgLyogdG9vbHRpcCAqL1xyXG4gICAgICAgIH1cclxuICAgICAgfSk7XHJcbiAgICAgIGNvbnN0IHRoaXNfaHlkID0gdGhpcy5jaGF0Lmh5ZDtcclxuICAgICAgT2JzaWRpYW4uc2V0SWNvbihjb250ZXh0X3ZpZXcsIFwiZXllXCIpO1xyXG4gICAgICBjb250ZXh0X3ZpZXcuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcclxuICAgICAgICAvLyBjb3B5IHRvIGNsaXBib2FyZFxyXG4gICAgICAgIG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KFwiYGBgc21hcnQtY29ubmVjdGlvbnNcXG5cIiArIHRoaXNfaHlkICsgXCJcXG5gYGBcXG5cIik7XHJcbiAgICAgICAgbmV3IE9ic2lkaWFuLk5vdGljZShcIltTbWFydCBDb25uZWN0aW9uc10gXHU0RTBBXHU0RTBCXHU2NTg3XHU0RUUzXHU3ODAxXHU1NzU3XHU1REYyXHU3RUNGXHU1OTBEXHU1MjM2XHU1MjMwXHU1MjZBXHU4RDM0XHU2NzdGXCIpO1xyXG4gICAgICB9KTtcclxuICAgIH1cclxuICAgIGlmKHRoaXMuY2hhdC5jb250ZXh0KSB7XHJcbiAgICAgIC8vIHJlbmRlciBjb3B5IGNvbnRleHQgYnV0dG9uXHJcbiAgICAgIGNvbnN0IGNvcHlfcHJvbXB0X2J1dHRvbiA9IHRoaXMuYWN0aXZlX2VsbS5jcmVhdGVFbChcInNwYW5cIiwge1xyXG4gICAgICAgIGNsczogXCJzYy1tc2ctYnV0dG9uXCIsXHJcbiAgICAgICAgYXR0cjoge1xyXG4gICAgICAgICAgdGl0bGU6IFwiQ29weSBwcm9tcHQgdG8gY2xpcGJvYXJkXCIgLyogdG9vbHRpcCAqL1xyXG4gICAgICAgIH1cclxuICAgICAgfSk7XHJcbiAgICAgIGNvbnN0IHRoaXNfY29udGV4dCA9IHRoaXMuY2hhdC5jb250ZXh0LnJlcGxhY2UoL1xcYFxcYFxcYC9nLCBcIlxcdGBgYFwiKS50cmltTGVmdCgpO1xyXG4gICAgICBPYnNpZGlhbi5zZXRJY29uKGNvcHlfcHJvbXB0X2J1dHRvbiwgXCJmaWxlc1wiKTtcclxuICAgICAgY29weV9wcm9tcHRfYnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XHJcbiAgICAgICAgLy8gY29weSB0byBjbGlwYm9hcmRcclxuICAgICAgICBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dChcImBgYHByb21wdC1jb250ZXh0XFxuXCIgKyB0aGlzX2NvbnRleHQgKyBcIlxcbmBgYFxcblwiKTtcclxuICAgICAgICBuZXcgT2JzaWRpYW4uTm90aWNlKFwiW1NtYXJ0IENvbm5lY3Rpb25zXSBcdTRFMEFcdTRFMEJcdTY1ODdcdTVERjJcdTU5MERcdTUyMzZcdTUyMzBcdTUyNkFcdThEMzRcdTY3N0ZcIik7XHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgLy8gcmVuZGVyIGNvcHkgYnV0dG9uXHJcbiAgICBjb25zdCBjb3B5X2J1dHRvbiA9IHRoaXMuYWN0aXZlX2VsbS5jcmVhdGVFbChcInNwYW5cIiwge1xyXG4gICAgICBjbHM6IFwic2MtbXNnLWJ1dHRvblwiLFxyXG4gICAgICBhdHRyOiB7XHJcbiAgICAgICAgdGl0bGU6IFwiQ29weSBtZXNzYWdlIHRvIGNsaXBib2FyZFwiIC8qIHRvb2x0aXAgKi9cclxuICAgICAgfVxyXG4gICAgfSk7XHJcbiAgICBPYnNpZGlhbi5zZXRJY29uKGNvcHlfYnV0dG9uLCBcImNvcHlcIik7XHJcbiAgICBjb3B5X2J1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICAvLyBjb3B5IG1lc3NhZ2UgdG8gY2xpcGJvYXJkXHJcbiAgICAgIG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KG1lc3NhZ2UudHJpbUxlZnQoKSk7XHJcbiAgICAgIG5ldyBPYnNpZGlhbi5Ob3RpY2UoXCJbU21hcnQgQ29ubmVjdGlvbnNdIE1lc3NhZ2UgY29waWVkIHRvIGNsaXBib2FyZFwiKTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgaGFuZGxlX2xpbmtzX2luX21lc3NhZ2UoKSB7XHJcbiAgICBjb25zdCBsaW5rcyA9IHRoaXMuYWN0aXZlX2VsbS5xdWVyeVNlbGVjdG9yQWxsKFwiYVwiKTtcclxuICAgIC8vIGlmIHRoaXMgYWN0aXZlIGVsZW1lbnQgY29udGFpbnMgYSBsaW5rXHJcbiAgICBpZiAobGlua3MubGVuZ3RoID4gMCkge1xyXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGxpbmtzLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgY29uc3QgbGluayA9IGxpbmtzW2ldO1xyXG4gICAgICAgIGNvbnN0IGxpbmtfdGV4dCA9IGxpbmsuZ2V0QXR0cmlidXRlKFwiZGF0YS1ocmVmXCIpO1xyXG4gICAgICAgIC8vIHRyaWdnZXIgaG92ZXIgZXZlbnQgb24gbGlua1xyXG4gICAgICAgIGxpbmsuYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlb3ZlclwiLCAoZXZlbnQpID0+IHtcclxuICAgICAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS50cmlnZ2VyKFwiaG92ZXItbGlua1wiLCB7XHJcbiAgICAgICAgICAgIGV2ZW50LFxyXG4gICAgICAgICAgICBzb3VyY2U6IFNNQVJUX0NPTk5FQ1RJT05TX0NIQVRfVklFV19UWVBFLFxyXG4gICAgICAgICAgICBob3ZlclBhcmVudDogbGluay5wYXJlbnRFbGVtZW50LFxyXG4gICAgICAgICAgICB0YXJnZXRFbDogbGluayxcclxuICAgICAgICAgICAgLy8gZXh0cmFjdCBsaW5rIHRleHQgZnJvbSBhLmRhdGEtaHJlZlxyXG4gICAgICAgICAgICBsaW5rdGV4dDogbGlua190ZXh0XHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICB9KTtcclxuICAgICAgICAvLyB0cmlnZ2VyIG9wZW4gbGluayBldmVudCBvbiBsaW5rXHJcbiAgICAgICAgbGluay5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiB7XHJcbiAgICAgICAgICBjb25zdCBsaW5rX3RmaWxlID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaXJzdExpbmtwYXRoRGVzdChsaW5rX3RleHQsIFwiL1wiKTtcclxuICAgICAgICAgIC8vIHByb3Blcmx5IGhhbmRsZSBpZiB0aGUgbWV0YS9jdHJsIGtleSBpcyBwcmVzc2VkXHJcbiAgICAgICAgICBjb25zdCBtb2QgPSBPYnNpZGlhbi5LZXltYXAuaXNNb2RFdmVudChldmVudCk7XHJcbiAgICAgICAgICAvLyBnZXQgbW9zdCByZWNlbnQgbGVhZlxyXG4gICAgICAgICAgbGV0IGxlYWYgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0TGVhZihtb2QpO1xyXG4gICAgICAgICAgbGVhZi5vcGVuRmlsZShsaW5rX3RmaWxlKTtcclxuICAgICAgICB9KTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgbmV3X21lc3NzYWdlX2J1YmJsZShmcm9tKSB7XHJcbiAgICBsZXQgbWVzc2FnZV9lbCA9IHRoaXMubWVzc2FnZV9jb250YWluZXIuY3JlYXRlRGl2KGBzYy1tZXNzYWdlICR7ZnJvbX1gKTtcclxuICAgIC8vIGNyZWF0ZSBtZXNzYWdlIGNvbnRlbnRcclxuICAgIHRoaXMuYWN0aXZlX2VsbSA9IG1lc3NhZ2VfZWwuY3JlYXRlRGl2KFwic2MtbWVzc2FnZS1jb250ZW50XCIpO1xyXG4gICAgLy8gc2V0IGxhc3QgZnJvbVxyXG4gICAgdGhpcy5sYXN0X2Zyb20gPSBmcm9tO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgcmVxdWVzdF9jaGF0Z3B0X2NvbXBsZXRpb24ob3B0cz17fSkge1xyXG4gICAgY29uc3QgY2hhdF9tbCA9IG9wdHMubWVzc2FnZXMgfHwgb3B0cy5jaGF0X21sIHx8IHRoaXMuY2hhdC5wcmVwYXJlX2NoYXRfbWwoKTtcclxuICAgIGNvbnNvbGUubG9nKFwiY2hhdF9tbFwiLCBjaGF0X21sKTtcclxuICAgIGNvbnN0IG1heF90b3RhbF90b2tlbnMgPSBNYXRoLnJvdW5kKGdldF9tYXhfY2hhcnModGhpcy5wbHVnaW4uc2V0dGluZ3Muc21hcnRfY2hhdF9tb2RlbCkgLyA0KTtcclxuICAgIGNvbnNvbGUubG9nKFwibWF4X3RvdGFsX3Rva2Vuc1wiLCBtYXhfdG90YWxfdG9rZW5zKTtcclxuICAgIGNvbnN0IGN1cnJfdG9rZW5fZXN0ID0gTWF0aC5yb3VuZChKU09OLnN0cmluZ2lmeShjaGF0X21sKS5sZW5ndGggLyAzKTtcclxuICAgIGNvbnNvbGUubG9nKFwiY3Vycl90b2tlbl9lc3RcIiwgY3Vycl90b2tlbl9lc3QpO1xyXG4gICAgbGV0IG1heF9hdmFpbGFibGVfdG9rZW5zID0gbWF4X3RvdGFsX3Rva2VucyAtIGN1cnJfdG9rZW5fZXN0O1xyXG4gICAgLy8gaWYgbWF4X2F2YWlsYWJsZV90b2tlbnMgaXMgbGVzcyB0aGFuIDAsIHNldCB0byAyMDBcclxuICAgIGlmKG1heF9hdmFpbGFibGVfdG9rZW5zIDwgMCkgbWF4X2F2YWlsYWJsZV90b2tlbnMgPSAyMDA7XHJcbiAgICBlbHNlIGlmKG1heF9hdmFpbGFibGVfdG9rZW5zID4gNDA5NikgbWF4X2F2YWlsYWJsZV90b2tlbnMgPSA0MDk2O1xyXG4gICAgY29uc29sZS5sb2coXCJtYXhfYXZhaWxhYmxlX3Rva2Vuc1wiLCBtYXhfYXZhaWxhYmxlX3Rva2Vucyk7XHJcbiAgICBvcHRzID0ge1xyXG4gICAgICBtb2RlbDogdGhpcy5wbHVnaW4uc2V0dGluZ3Muc21hcnRfY2hhdF9tb2RlbCxcclxuICAgICAgbWVzc2FnZXM6IGNoYXRfbWwsXHJcbiAgICAgIC8vIG1heF90b2tlbnM6IDI1MCxcclxuICAgICAgbWF4X3Rva2VuczogbWF4X2F2YWlsYWJsZV90b2tlbnMsXHJcbiAgICAgIHRlbXBlcmF0dXJlOiAwLjMsXHJcbiAgICAgIHRvcF9wOiAxLFxyXG4gICAgICBwcmVzZW5jZV9wZW5hbHR5OiAwLFxyXG4gICAgICBmcmVxdWVuY3lfcGVuYWx0eTogMCxcclxuICAgICAgc3RyZWFtOiB0cnVlLFxyXG4gICAgICBzdG9wOiBudWxsLFxyXG4gICAgICBuOiAxLFxyXG4gICAgICAvLyBsb2dpdF9iaWFzOiBsb2dpdF9iaWFzLFxyXG4gICAgICAuLi5vcHRzXHJcbiAgICB9XHJcbiAgICAvLyBjb25zb2xlLmxvZyhvcHRzLm1lc3NhZ2VzKTtcclxuICAgIGxldCBwcml2YWN5U3RyID0gb3B0cy5wcml2YWN5U3RyIHx8ICcnO1xyXG4gICAgZGVsZXRlIG9wdHMucHJpdmFjeVN0cjtcclxuICAgIGlmKG9wdHMuc3RyZWFtKSB7XHJcbiAgICAgIGNvbnN0IGZ1bGxfc3RyID0gYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAvLyBjb25zb2xlLmxvZyhcInN0cmVhbVwiLCBvcHRzKTtcclxuICAgICAgICAgIGNvbnN0IHVybCA9IGAke3RoaXMucGx1Z2luLnNldHRpbmdzLmFwaV9lbmRwb2ludH0vdjEvY2hhdC9jb21wbGV0aW9uc2A7XHJcbiAgICAgICAgICB0aGlzLmFjdGl2ZV9zdHJlYW0gPSBuZXcgU2NTdHJlYW1lcih1cmwsIHtcclxuICAgICAgICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxyXG4gICAgICAgICAgICAgIEF1dGhvcml6YXRpb246IGBCZWFyZXIgJHt0aGlzLnBsdWdpbi5zZXR0aW5ncy5hcGlfa2V5fWBcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgbWV0aG9kOiBcIlBPU1RcIixcclxuICAgICAgICAgICAgcGF5bG9hZDogSlNPTi5zdHJpbmdpZnkob3B0cylcclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgbGV0IHR4dCA9IFwiXCI7XHJcbiAgICAgICAgICB0aGlzLmFjdGl2ZV9zdHJlYW0uYWRkRXZlbnRMaXN0ZW5lcihcIm1lc3NhZ2VcIiwgKGUpID0+IHtcclxuICAgICAgICAgICAgaWYgKGUuZGF0YSAhPSBcIltET05FXVwiKSB7XHJcbiAgICAgICAgICAgICAgbGV0IHJlc3AgPSBudWxsO1xyXG4gICAgICAgICAgICAgIHRyeXtcclxuICAgICAgICAgICAgICAgIHJlc3AgPSBKU09OLnBhcnNlKGUuZGF0YSk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCB0ZXh0ID0gcmVzcC5jaG9pY2VzWzBdLmRlbHRhLmNvbnRlbnQ7XHJcbiAgICAgICAgICAgICAgICBpZighdGV4dCkgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgdHh0ICs9IHRleHQ7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnJlbmRlcl9tZXNzYWdlKHRleHQsIFwiYXNzaXN0YW50XCIsIHRydWUsIHByaXZhY3lTdHIpO1xyXG4gICAgICAgICAgICAgIH1jYXRjaChlcnIpe1xyXG4gICAgICAgICAgICAgICAgLy8gY29uc29sZS5sb2coZXJyKTtcclxuICAgICAgICAgICAgICAgIGlmKGUuZGF0YS5pbmRleE9mKCd9eycpID4gLTEpIGUuZGF0YSA9IGUuZGF0YS5yZXBsYWNlKC99ey9nLCAnfSx7Jyk7XHJcbiAgICAgICAgICAgICAgICByZXNwID0gSlNPTi5wYXJzZShgWyR7ZS5kYXRhfV1gKTtcclxuICAgICAgICAgICAgICAgIHJlc3AuZm9yRWFjaCgocikgPT4ge1xyXG4gICAgICAgICAgICAgICAgICBjb25zdCB0ZXh0ID0gci5jaG9pY2VzWzBdLmRlbHRhLmNvbnRlbnQ7XHJcbiAgICAgICAgICAgICAgICAgIGlmKCF0ZXh0KSByZXR1cm47XHJcbiAgICAgICAgICAgICAgICAgIHR4dCArPSB0ZXh0O1xyXG4gICAgICAgICAgICAgICAgICB0aGlzLnJlbmRlcl9tZXNzYWdlKHRleHQsIFwiYXNzaXN0YW50XCIsIHRydWUsIHByaXZhY3lTdHIpO1xyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgIHRoaXMuZW5kX3N0cmVhbSgpO1xyXG4gICAgICAgICAgICAgIHJlc29sdmUodHh0KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgICB0aGlzLmFjdGl2ZV9zdHJlYW0uYWRkRXZlbnRMaXN0ZW5lcihcInJlYWR5c3RhdGVjaGFuZ2VcIiwgKGUpID0+IHtcclxuICAgICAgICAgICAgaWYgKGUucmVhZHlTdGF0ZSA+PSAyKSB7XHJcbiAgICAgICAgICAgICAgY29uc29sZS5sb2coXCJSZWFkeVN0YXRlOiBcIiArIGUucmVhZHlTdGF0ZSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgdGhpcy5hY3RpdmVfc3RyZWFtLmFkZEV2ZW50TGlzdGVuZXIoXCJlcnJvclwiLCAoZSkgPT4ge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGUpO1xyXG4gICAgICAgICAgICBuZXcgT2JzaWRpYW4uTm90aWNlKFwiU21hcnQgQ29ubmVjdGlvbnMgXHU4RkRCXHU4ODRDXHU2RDQxXHU1RjBGXHU4RkRFXHU2M0E1XHU3Njg0XHU4RkM3XHU3QTBCXHU1MUZBXHU3M0IwXHU5NTE5XHU4QkVGXHUzMDAyXHU4QkY3XHU2N0U1XHU3NzBCXHU4QzAzXHU4QkQ1XHU2M0E3XHU1MjM2XHU1M0YwXHUzMDAyXCIpO1xyXG4gICAgICAgICAgICB0aGlzLnJlbmRlcl9tZXNzYWdlKFwiKkFQSSBcdThCRjdcdTZDNDJcdTk1MTlcdThCRUYuIFx1OEJGN1x1NjdFNVx1NzcwQlx1OEMwM1x1OEJENVx1NjNBN1x1NTIzNlx1NTNGMC4qXCIsIFwiYXNzaXN0YW50XCIsIGZhbHNlLCBwcml2YWN5U3RyKTtcclxuICAgICAgICAgICAgdGhpcy5lbmRfc3RyZWFtKCk7XHJcbiAgICAgICAgICAgIHJlamVjdChlKTtcclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgdGhpcy5hY3RpdmVfc3RyZWFtLnN0cmVhbSgpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICAgICAgY29uc29sZS5lcnJvcihlcnIpO1xyXG4gICAgICAgICAgbmV3IE9ic2lkaWFuLk5vdGljZShcIlNtYXJ0IENvbm5lY3Rpb25zIFx1OEZEQlx1ODg0Q1x1NkQ0MVx1NUYwRlx1OEZERVx1NjNBNVx1NzY4NFx1OEZDN1x1N0EwQlx1NTFGQVx1NzNCMFx1OTUxOVx1OEJFRlx1MzAwMlx1OEJGN1x1NjdFNVx1NzcwQlx1OEMwM1x1OEJENVx1NjNBN1x1NTIzNlx1NTNGMFx1MzAwMlwiKTtcclxuICAgICAgICAgIHRoaXMuZW5kX3N0cmVhbSgpO1xyXG4gICAgICAgICAgcmVqZWN0KGVycik7XHJcbiAgICAgICAgfVxyXG4gICAgICB9KTtcclxuICAgICAgLy8gY29uc29sZS5sb2coZnVsbF9zdHIpO1xyXG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcl9tZXNzYWdlKGZ1bGxfc3RyLCBcImFzc2lzdGFudFwiLCBmYWxzZSwgcHJpdmFjeVN0cik7XHJcbiAgICAgIHRoaXMuY2hhdC5uZXdfbWVzc2FnZV9pbl90aHJlYWQoe1xyXG4gICAgICAgIHJvbGU6IFwiYXNzaXN0YW50XCIsXHJcbiAgICAgICAgY29udGVudDogZnVsbF9zdHJcclxuICAgICAgfSk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1lbHNle1xyXG4gICAgICB0cnl7XHJcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCAoMCwgT2JzaWRpYW4ucmVxdWVzdFVybCkoe1xyXG4gICAgICAgICAgdXJsOiBgJHt0aGlzLnBsdWdpbi5zZXR0aW5ncy5hcGlfZW5kcG9pbnR9L3YxL2NoYXQvY29tcGxldGlvbnNgLFxyXG4gICAgICAgICAgbWV0aG9kOiBcIlBPU1RcIixcclxuICAgICAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAgICAgQXV0aG9yaXphdGlvbjogYEJlYXJlciAke3RoaXMucGx1Z2luLnNldHRpbmdzLmFwaV9rZXl9YCxcclxuICAgICAgICAgICAgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCJcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICBjb250ZW50VHlwZTogXCJhcHBsaWNhdGlvbi9qc29uXCIsXHJcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShvcHRzKSxcclxuICAgICAgICAgIHRocm93OiBmYWxzZVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIC8vIGNvbnNvbGUubG9nKHJlc3BvbnNlKTtcclxuICAgICAgICByZXR1cm4gSlNPTi5wYXJzZShyZXNwb25zZS50ZXh0KS5jaG9pY2VzWzBdLm1lc3NhZ2UuY29udGVudDtcclxuICAgICAgfWNhdGNoKGVycil7XHJcbiAgICAgICAgbmV3IE9ic2lkaWFuLk5vdGljZShgU21hcnQgQ29ubmVjdGlvbnMgQVBJIFx1OEMwM1x1NzUyOFx1OTUxOVx1OEJFRiA6OiAke2Vycn1gKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgZW5kX3N0cmVhbSgpIHtcclxuICAgIGlmKHRoaXMuYWN0aXZlX3N0cmVhbSl7XHJcbiAgICAgIHRoaXMuYWN0aXZlX3N0cmVhbS5jbG9zZSgpO1xyXG4gICAgICB0aGlzLmFjdGl2ZV9zdHJlYW0gPSBudWxsO1xyXG4gICAgfVxyXG4gICAgdGhpcy51bnNldF9zdHJlYW1pbmdfdXgoKTtcclxuICAgIGlmKHRoaXMuZG90ZG90ZG90X2ludGVydmFsKXtcclxuICAgICAgY2xlYXJJbnRlcnZhbCh0aGlzLmRvdGRvdGRvdF9pbnRlcnZhbCk7XHJcbiAgICAgIHRoaXMuZG90ZG90ZG90X2ludGVydmFsID0gbnVsbDtcclxuICAgICAgLy8gcmVtb3ZlIHBhcmVudCBvZiBhY3RpdmVfZWxtXHJcbiAgICAgIHRoaXMuYWN0aXZlX2VsbS5wYXJlbnRFbGVtZW50LnJlbW92ZSgpO1xyXG4gICAgICB0aGlzLmFjdGl2ZV9lbG0gPSBudWxsO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgZ2V0X2NvbnRleHRfaHlkZSh1c2VyX2lucHV0KSB7XHJcbiAgICB0aGlzLmNoYXQucmVzZXRfY29udGV4dCgpO1xyXG4gICAgLy8gY291bnQgY3VycmVudCBjaGF0IG1sIG1lc3NhZ2VzIHRvIGRldGVybWluZSAncXVlc3Rpb24nIG9yICdjaGF0IGxvZycgd29yZGluZ1xyXG4gICAgY29uc3QgaHlkX2lucHV0ID0gYEFudGljaXBhdGUgd2hhdCB0aGUgdXNlciBpcyBzZWVraW5nLiBSZXNwb25kIGluIHRoZSBmb3JtIG9mIGEgaHlwb3RoZXRpY2FsIG5vdGUgd3JpdHRlbiBieSB0aGUgdXNlci4gVGhlIG5vdGUgbWF5IGNvbnRhaW4gc3RhdGVtZW50cyBhcyBwYXJhZ3JhcGhzLCBsaXN0cywgb3IgY2hlY2tsaXN0cyBpbiBtYXJrZG93biBmb3JtYXQgd2l0aCBubyBoZWFkaW5ncy4gUGxlYXNlIHJlc3BvbmQgd2l0aCBvbmUgaHlwb3RoZXRpY2FsIG5vdGUgYW5kIGFic3RhaW4gZnJvbSBhbnkgb3RoZXIgY29tbWVudGFyeS4gVXNlIHRoZSBmb3JtYXQ6IFBBUkVOVCBGT0xERVIgTkFNRSA+IENISUxEIEZPTERFUiBOQU1FID4gRklMRSBOQU1FID4gSEVBRElORyAxID4gSEVBRElORyAyID4gSEVBRElORyAzOiBIWVBPVEhFVElDQUwgTk9URSBDT05URU5UUy5gO1xyXG4gICAgLy8gY29tcGxldGVcclxuICAgIGNvbnN0IGNoYXRtbCA9IFtcclxuICAgICAge1xyXG4gICAgICAgIHJvbGU6IFwic3lzdGVtXCIsXHJcbiAgICAgICAgY29udGVudDogaHlkX2lucHV0IFxyXG4gICAgICB9LFxyXG4gICAgICB7XHJcbiAgICAgICAgcm9sZTogXCJ1c2VyXCIsXHJcbiAgICAgICAgY29udGVudDogdXNlcl9pbnB1dFxyXG4gICAgICB9XHJcbiAgICBdO1xyXG4gICAgY29uc3QgaHlkID0gYXdhaXQgdGhpcy5yZXF1ZXN0X2NoYXRncHRfY29tcGxldGlvbih7XHJcbiAgICAgIG1lc3NhZ2VzOiBjaGF0bWwsXHJcbiAgICAgIHN0cmVhbTogZmFsc2UsXHJcbiAgICAgIHRlbXBlcmF0dXJlOiAwLFxyXG4gICAgICBtYXhfdG9rZW5zOiAxMzcsXHJcbiAgICB9KTtcclxuICAgIHRoaXMuY2hhdC5oeWQgPSBoeWQ7XHJcbiAgICAvLyBjb25zb2xlLmxvZyhoeWQpO1xyXG4gICAgbGV0IGZpbHRlciA9IHt9O1xyXG4gICAgLy8gaWYgY29udGFpbnMgZm9sZGVyIHJlZmVyZW5jZSByZXByZXNlbnRlZCBieSAvZm9sZGVyL1xyXG4gICAgaWYodGhpcy5jaGF0LmNvbnRhaW5zX2ZvbGRlcl9yZWZlcmVuY2UodXNlcl9pbnB1dCkpIHtcclxuICAgICAgLy8gZ2V0IGZvbGRlciByZWZlcmVuY2VzXHJcbiAgICAgIGNvbnN0IGZvbGRlcl9yZWZzID0gdGhpcy5jaGF0LmdldF9mb2xkZXJfcmVmZXJlbmNlcyh1c2VyX2lucHV0KTtcclxuICAgICAgLy8gY29uc29sZS5sb2coZm9sZGVyX3JlZnMpO1xyXG4gICAgICAvLyBpZiBmb2xkZXIgcmVmZXJlbmNlcyBhcmUgdmFsaWQgKHN0cmluZyBvciBhcnJheSBvZiBzdHJpbmdzKVxyXG4gICAgICBpZihmb2xkZXJfcmVmcyl7XHJcbiAgICAgICAgZmlsdGVyID0ge1xyXG4gICAgICAgICAgcGF0aF9iZWdpbnNfd2l0aDogZm9sZGVyX3JlZnNcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICAvLyBzZWFyY2ggZm9yIG5lYXJlc3QgYmFzZWQgb24gaHlkXHJcbiAgICBsZXQgbmVhcmVzdCA9IGF3YWl0IHRoaXMucGx1Z2luLmFwaS5zZWFyY2goaHlkLCBmaWx0ZXIpO1xyXG4gICAgY29uc29sZS5sb2coXCJuZWFyZXN0XCIsIG5lYXJlc3QubGVuZ3RoKTtcclxuICAgIG5lYXJlc3QgPSB0aGlzLmdldF9uZWFyZXN0X3VudGlsX25leHRfZGV2X2V4Y2VlZHNfc3RkX2RldihuZWFyZXN0KTtcclxuICAgIGNvbnNvbGUubG9nKFwibmVhcmVzdCBhZnRlciBzdGQgZGV2IHNsaWNlXCIsIG5lYXJlc3QubGVuZ3RoKTtcclxuICAgIG5lYXJlc3QgPSB0aGlzLnNvcnRfYnlfbGVuX2FkanVzdGVkX3NpbWlsYXJpdHkobmVhcmVzdCk7XHJcbiAgICBcclxuICAgIHJldHVybiBhd2FpdCB0aGlzLmdldF9jb250ZXh0X2Zvcl9wcm9tcHQobmVhcmVzdCk7XHJcbiAgfVxyXG4gIFxyXG4gIFxyXG4gIHNvcnRfYnlfbGVuX2FkanVzdGVkX3NpbWlsYXJpdHkobmVhcmVzdCkge1xyXG4gICAgLy8gcmUtc29ydCBieSBxdW90aWVudCBvZiBzaW1pbGFyaXR5IGRpdmlkZWQgYnkgbGVuIERFU0NcclxuICAgIG5lYXJlc3QgPSBuZWFyZXN0LnNvcnQoKGEsIGIpID0+IHtcclxuICAgICAgY29uc3QgYV9zY29yZSA9IGEuc2ltaWxhcml0eSAvIGEubGVuO1xyXG4gICAgICBjb25zdCBiX3Njb3JlID0gYi5zaW1pbGFyaXR5IC8gYi5sZW47XHJcbiAgICAgIC8vIGlmIGEgaXMgZ3JlYXRlciB0aGFuIGIsIHJldHVybiAtMVxyXG4gICAgICBpZiAoYV9zY29yZSA+IGJfc2NvcmUpXHJcbiAgICAgICAgcmV0dXJuIC0xO1xyXG4gICAgICAvLyBpZiBhIGlzIGxlc3MgdGhhbiBiLCByZXR1cm4gMVxyXG4gICAgICBpZiAoYV9zY29yZSA8IGJfc2NvcmUpXHJcbiAgICAgICAgcmV0dXJuIDE7XHJcbiAgICAgIC8vIGlmIGEgaXMgZXF1YWwgdG8gYiwgcmV0dXJuIDBcclxuICAgICAgcmV0dXJuIDA7XHJcbiAgICB9KTtcclxuICAgIHJldHVybiBuZWFyZXN0O1xyXG4gIH1cclxuXHJcbiAgZ2V0X25lYXJlc3RfdW50aWxfbmV4dF9kZXZfZXhjZWVkc19zdGRfZGV2KG5lYXJlc3QpIHtcclxuICAgIC8vIGdldCBzdGQgZGV2IG9mIHNpbWlsYXJpdHlcclxuICAgIGNvbnN0IHNpbSA9IG5lYXJlc3QubWFwKChuKSA9PiBuLnNpbWlsYXJpdHkpO1xyXG4gICAgY29uc3QgbWVhbiA9IHNpbS5yZWR1Y2UoKGEsIGIpID0+IGEgKyBiKSAvIHNpbS5sZW5ndGg7XHJcbiAgICBsZXQgc3RkX2RldiA9IE1hdGguc3FydChzaW0ubWFwKCh4KSA9PiBNYXRoLnBvdyh4IC0gbWVhbiwgMikpLnJlZHVjZSgoYSwgYikgPT4gYSArIGIpIC8gc2ltLmxlbmd0aCk7XHJcbiAgICAvLyBzbGljZSB3aGVyZSBuZXh0IGl0ZW0gZGV2aWF0aW9uIGlzIGdyZWF0ZXIgdGhhbiBzdGRfZGV2XHJcbiAgICBsZXQgc2xpY2VfaSA9IDA7XHJcbiAgICB3aGlsZSAoc2xpY2VfaSA8IG5lYXJlc3QubGVuZ3RoKSB7XHJcbiAgICAgIGNvbnN0IG5leHQgPSBuZWFyZXN0W3NsaWNlX2kgKyAxXTtcclxuICAgICAgaWYgKG5leHQpIHtcclxuICAgICAgICBjb25zdCBuZXh0X2RldiA9IE1hdGguYWJzKG5leHQuc2ltaWxhcml0eSAtIG5lYXJlc3Rbc2xpY2VfaV0uc2ltaWxhcml0eSk7XHJcbiAgICAgICAgaWYgKG5leHRfZGV2ID4gc3RkX2Rldikge1xyXG4gICAgICAgICAgaWYoc2xpY2VfaSA8IDMpIHN0ZF9kZXYgPSBzdGRfZGV2ICogMS41O1xyXG4gICAgICAgICAgZWxzZSBicmVhaztcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgc2xpY2VfaSsrO1xyXG4gICAgfVxyXG4gICAgLy8gc2VsZWN0IHRvcCByZXN1bHRzXHJcbiAgICBuZWFyZXN0ID0gbmVhcmVzdC5zbGljZSgwLCBzbGljZV9pKzEpO1xyXG4gICAgcmV0dXJuIG5lYXJlc3Q7XHJcbiAgfVxyXG4gIC8vIHRoaXMudGVzdF9nZXRfbmVhcmVzdF91bnRpbF9uZXh0X2Rldl9leGNlZWRzX3N0ZF9kZXYoKTtcclxuICAvLyAvLyB0ZXN0IGdldF9uZWFyZXN0X3VudGlsX25leHRfZGV2X2V4Y2VlZHNfc3RkX2RldlxyXG4gIC8vIHRlc3RfZ2V0X25lYXJlc3RfdW50aWxfbmV4dF9kZXZfZXhjZWVkc19zdGRfZGV2KCkge1xyXG4gIC8vICAgY29uc3QgbmVhcmVzdCA9IFt7c2ltaWxhcml0eTogMC45OX0sIHtzaW1pbGFyaXR5OiAwLjk4fSwge3NpbWlsYXJpdHk6IDAuOTd9LCB7c2ltaWxhcml0eTogMC45Nn0sIHtzaW1pbGFyaXR5OiAwLjk1fSwge3NpbWlsYXJpdHk6IDAuOTR9LCB7c2ltaWxhcml0eTogMC45M30sIHtzaW1pbGFyaXR5OiAwLjkyfSwge3NpbWlsYXJpdHk6IDAuOTF9LCB7c2ltaWxhcml0eTogMC45fSwge3NpbWlsYXJpdHk6IDAuNzl9LCB7c2ltaWxhcml0eTogMC43OH0sIHtzaW1pbGFyaXR5OiAwLjc3fSwge3NpbWlsYXJpdHk6IDAuNzZ9LCB7c2ltaWxhcml0eTogMC43NX0sIHtzaW1pbGFyaXR5OiAwLjc0fSwge3NpbWlsYXJpdHk6IDAuNzN9LCB7c2ltaWxhcml0eTogMC43Mn1dO1xyXG4gIC8vICAgY29uc3QgcmVzdWx0ID0gdGhpcy5nZXRfbmVhcmVzdF91bnRpbF9uZXh0X2Rldl9leGNlZWRzX3N0ZF9kZXYobmVhcmVzdCk7XHJcbiAgLy8gICBpZihyZXN1bHQubGVuZ3RoICE9PSAxMCl7XHJcbiAgLy8gICAgIGNvbnNvbGUuZXJyb3IoXCJnZXRfbmVhcmVzdF91bnRpbF9uZXh0X2Rldl9leGNlZWRzX3N0ZF9kZXYgZmFpbGVkXCIsIHJlc3VsdCk7XHJcbiAgLy8gICB9XHJcbiAgLy8gfVxyXG5cclxuICBhc3luYyBnZXRfY29udGV4dF9mb3JfcHJvbXB0KG5lYXJlc3QpIHtcclxuICAgIGxldCBjb250ZXh0ID0gW107XHJcbiAgICBjb25zdCBNQVhfU09VUkNFUyA9ICh0aGlzLnBsdWdpbi5zZXR0aW5ncy5zbWFydF9jaGF0X21vZGVsID09PSAnZ3B0LTQtMTEwNi1wcmV2aWV3JykgPyA0MiA6IDIwO1xyXG4gICAgY29uc3QgTUFYX0NIQVJTID0gZ2V0X21heF9jaGFycyh0aGlzLnBsdWdpbi5zZXR0aW5ncy5zbWFydF9jaGF0X21vZGVsKSAvIDI7XHJcbiAgICBsZXQgY2hhcl9hY2N1bSA9IDA7XHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IG5lYXJlc3QubGVuZ3RoOyBpKyspIHtcclxuICAgICAgaWYgKGNvbnRleHQubGVuZ3RoID49IE1BWF9TT1VSQ0VTKVxyXG4gICAgICAgIGJyZWFrO1xyXG4gICAgICBpZiAoY2hhcl9hY2N1bSA+PSBNQVhfQ0hBUlMpXHJcbiAgICAgICAgYnJlYWs7XHJcbiAgICAgIGlmICh0eXBlb2YgbmVhcmVzdFtpXS5saW5rICE9PSAnc3RyaW5nJylcclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgLy8gZ2VuZXJhdGUgYnJlYWRjcnVtYnNcclxuICAgICAgY29uc3QgYnJlYWRjcnVtYnMgPSBuZWFyZXN0W2ldLmxpbmsucmVwbGFjZSgvIy9nLCBcIiA+IFwiKS5yZXBsYWNlKFwiLm1kXCIsIFwiXCIpLnJlcGxhY2UoL1xcLy9nLCBcIiA+IFwiKTtcclxuICAgICAgbGV0IG5ld19jb250ZXh0ID0gYCR7YnJlYWRjcnVtYnN9OlxcbmA7XHJcbiAgICAgIC8vIGdldCBtYXggYXZhaWxhYmxlIGNoYXJzIHRvIGFkZCB0byBjb250ZXh0XHJcbiAgICAgIGNvbnN0IG1heF9hdmFpbGFibGVfY2hhcnMgPSBNQVhfQ0hBUlMgLSBjaGFyX2FjY3VtIC0gbmV3X2NvbnRleHQubGVuZ3RoO1xyXG4gICAgICBpZiAobmVhcmVzdFtpXS5saW5rLmluZGV4T2YoXCIjXCIpICE9PSAtMSkgeyAvLyBpcyBibG9ja1xyXG4gICAgICAgIG5ld19jb250ZXh0ICs9IGF3YWl0IHRoaXMucGx1Z2luLmJsb2NrX3JldHJpZXZlcihuZWFyZXN0W2ldLmxpbmssIHsgbWF4X2NoYXJzOiBtYXhfYXZhaWxhYmxlX2NoYXJzIH0pO1xyXG4gICAgICB9IGVsc2UgeyAvLyBpcyBmaWxlXHJcbiAgICAgICAgbmV3X2NvbnRleHQgKz0gYXdhaXQgdGhpcy5wbHVnaW4uZmlsZV9yZXRyaWV2ZXIobmVhcmVzdFtpXS5saW5rLCB7IG1heF9jaGFyczogbWF4X2F2YWlsYWJsZV9jaGFycyB9KTtcclxuICAgICAgfVxyXG4gICAgICAvLyBhZGQgdG8gY2hhcl9hY2N1bVxyXG4gICAgICBjaGFyX2FjY3VtICs9IG5ld19jb250ZXh0Lmxlbmd0aDtcclxuICAgICAgLy8gYWRkIHRvIGNvbnRleHRcclxuICAgICAgY29udGV4dC5wdXNoKHtcclxuICAgICAgICBsaW5rOiBuZWFyZXN0W2ldLmxpbmssXHJcbiAgICAgICAgdGV4dDogbmV3X2NvbnRleHRcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICAvLyBjb250ZXh0IHNvdXJjZXNcclxuICAgIGNvbnNvbGUubG9nKFwiY29udGV4dCBzb3VyY2VzOiBcIiArIGNvbnRleHQubGVuZ3RoKTtcclxuICAgIC8vIGNoYXJfYWNjdW0gZGl2aWRlZCBieSA0IGFuZCByb3VuZGVkIHRvIG5lYXJlc3QgaW50ZWdlciBmb3IgZXN0aW1hdGVkIHRva2Vuc1xyXG4gICAgY29uc29sZS5sb2coXCJ0b3RhbCBjb250ZXh0IHRva2VuczogflwiICsgTWF0aC5yb3VuZChjaGFyX2FjY3VtIC8gMy41KSk7XHJcbiAgICAvLyBidWlsZCBjb250ZXh0IGlucHV0XHJcbiAgICB0aGlzLmNoYXQuY29udGV4dCA9IGBBbnRpY2lwYXRlIHRoZSB0eXBlIG9mIGFuc3dlciBkZXNpcmVkIGJ5IHRoZSB1c2VyLiBJbWFnaW5lIHRoZSBmb2xsb3dpbmcgJHtjb250ZXh0Lmxlbmd0aH0gbm90ZXMgd2VyZSB3cml0dGVuIGJ5IHRoZSB1c2VyIGFuZCBjb250YWluIGFsbCB0aGUgbmVjZXNzYXJ5IGluZm9ybWF0aW9uIHRvIGFuc3dlciB0aGUgdXNlcidzIHF1ZXN0aW9uLiBCZWdpbiByZXNwb25zZXMgd2l0aCBcIiR7U01BUlRfVFJBTlNMQVRJT05bdGhpcy5wbHVnaW4uc2V0dGluZ3MubGFuZ3VhZ2VdLnByb21wdH0uLi5cImA7XHJcbiAgICBmb3IobGV0IGkgPSAwOyBpIDwgY29udGV4dC5sZW5ndGg7IGkrKykge1xyXG4gICAgICB0aGlzLmNoYXQuY29udGV4dCArPSBgXFxuLS0tQkVHSU4gIyR7aSsxfS0tLVxcbiR7Y29udGV4dFtpXS50ZXh0fVxcbi0tLUVORCAjJHtpKzF9LS0tYDtcclxuICAgIH1cclxuICAgIHJldHVybiB0aGlzLmNoYXQuY29udGV4dDtcclxuICB9XHJcblxyXG5cclxufVxyXG5cclxuZnVuY3Rpb24gZ2V0X21heF9jaGFycyhtb2RlbD1cImdwdC0zLjUtdHVyYm9cIikge1xyXG4gIGNvbnN0IE1BWF9DSEFSX01BUCA9IHtcclxuICAgIFwiZ3B0LTMuNS10dXJiby0xNmtcIjogNDgwMDAsXHJcbiAgICBcImdwdC00XCI6IDI0MDAwLFxyXG4gICAgXCJncHQtMy41LXR1cmJvXCI6IDEyMDAwLFxyXG4gICAgXCJncHQtNC0xMTA2LXByZXZpZXdcIjogMjAwMDAwLFxyXG4gIH07XHJcbiAgcmV0dXJuIE1BWF9DSEFSX01BUFttb2RlbF07XHJcbn1cclxuLyoqXHJcbiAqIFNtYXJ0Q29ubmVjdGlvbnNDaGF0TW9kZWxcclxuICogLS0tXHJcbiAqIC0gJ3RocmVhZCcgZm9ybWF0OiBBcnJheVtBcnJheVtPYmplY3R7cm9sZSwgY29udGVudCwgaHlkZX1dXVxyXG4gKiAgLSBbVHVyblt2YXJpYXRpb257fV0sIFR1cm5bdmFyaWF0aW9ue30sIHZhcmlhdGlvbnt9XSwgLi4uXVxyXG4gKiAtIFNhdmVzIGluICd0aHJlYWQnIGZvcm1hdCB0byBKU09OIGZpbGUgaW4gLnNtYXJ0LWNvbm5lY3Rpb25zIGZvbGRlciB1c2luZyBjaGF0X2lkIGFzIGZpbGVuYW1lXHJcbiAqIC0gTG9hZHMgY2hhdCBpbiAndGhyZWFkJyBmb3JtYXQgQXJyYXlbQXJyYXlbT2JqZWN0e3JvbGUsIGNvbnRlbnQsIGh5ZGV9XV0gZnJvbSBKU09OIGZpbGUgaW4gLnNtYXJ0LWNvbm5lY3Rpb25zIGZvbGRlclxyXG4gKiAtIHByZXBhcmVzIGNoYXRfbWwgcmV0dXJucyBpbiAnQ2hhdE1MJyBmb3JtYXQgXHJcbiAqICAtIHN0cmlwcyBhbGwgYnV0IHJvbGUgYW5kIGNvbnRlbnQgcHJvcGVydGllcyBmcm9tIE9iamVjdCBpbiBDaGF0TUwgZm9ybWF0XHJcbiAqIC0gQ2hhdE1MIEFycmF5W09iamVjdHtyb2xlLCBjb250ZW50fV1cclxuICogIC0gW0N1cnJlbnRfVmFyaWF0aW9uX0Zvcl9UdXJuXzF7fSwgQ3VycmVudF9WYXJpYXRpb25fRm9yX1R1cm5fMnt9LCAuLi5dXHJcbiAqL1xyXG5jbGFzcyBTbWFydENvbm5lY3Rpb25zQ2hhdE1vZGVsIHtcclxuICBjb25zdHJ1Y3RvcihwbHVnaW4pIHtcclxuICAgIHRoaXMuYXBwID0gcGx1Z2luLmFwcDtcclxuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xyXG4gICAgdGhpcy5jaGF0X2lkID0gbnVsbDtcclxuICAgIHRoaXMuY2hhdF9tbCA9IFtdO1xyXG4gICAgdGhpcy5jb250ZXh0ID0gbnVsbDtcclxuICAgIHRoaXMuaHlkID0gbnVsbDtcclxuICAgIHRoaXMudGhyZWFkID0gW107XHJcbiAgfVxyXG4gIGFzeW5jIHNhdmVfY2hhdCgpIHtcclxuICAgIC8vIHJldHVybiBpZiB0aHJlYWQgaXMgZW1wdHlcclxuICAgIGlmICh0aGlzLnRocmVhZC5sZW5ndGggPT09IDApIHJldHVybjtcclxuICAgIC8vIHNhdmUgY2hhdCB0byBmaWxlIGluIC5zbWFydC1jb25uZWN0aW9ucyBmb2xkZXJcclxuICAgIC8vIGNyZWF0ZSAuc21hcnQtY29ubmVjdGlvbnMvY2hhdHMvIGZvbGRlciBpZiBpdCBkb2Vzbid0IGV4aXN0XHJcbiAgICBpZiAoIShhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLmV4aXN0cyhcIi5zbWFydC1jb25uZWN0aW9ucy9jaGF0c1wiKSkpIHtcclxuICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci5ta2RpcihcIi5zbWFydC1jb25uZWN0aW9ucy9jaGF0c1wiKTtcclxuICAgIH1cclxuICAgIC8vIGlmIGNoYXRfaWQgaXMgbm90IHNldCwgc2V0IGl0IHRvIFVOVElUTEVELSR7dW5peCB0aW1lc3RhbXB9XHJcbiAgICBpZiAoIXRoaXMuY2hhdF9pZCkge1xyXG4gICAgICB0aGlzLmNoYXRfaWQgPSB0aGlzLm5hbWUoKSArIFwiXHUyMDE0XCIgKyB0aGlzLmdldF9maWxlX2RhdGVfc3RyaW5nKCk7XHJcbiAgICB9XHJcbiAgICAvLyB2YWxpZGF0ZSBjaGF0X2lkIGlzIHNldCB0byB2YWxpZCBmaWxlbmFtZSBjaGFyYWN0ZXJzIChsZXR0ZXJzLCBudW1iZXJzLCB1bmRlcnNjb3JlcywgZGFzaGVzLCBlbSBkYXNoLCBhbmQgc3BhY2VzKVxyXG4gICAgaWYgKCF0aGlzLmNoYXRfaWQubWF0Y2goL15bYS16QS1aMC05X1x1MjAxNFxcLSBdKyQvKSkge1xyXG4gICAgICBjb25zb2xlLmxvZyhcIkludmFsaWQgY2hhdF9pZDogXCIgKyB0aGlzLmNoYXRfaWQpO1xyXG4gICAgICBuZXcgT2JzaWRpYW4uTm90aWNlKFwiW1NtYXJ0IENvbm5lY3Rpb25zXSBcdTRGRERcdTVCNThcdTU5MzFcdThEMjUuIFx1OTc1RVx1NkNENVx1NEYxQVx1OEJERCBpZCAoY2hhdF9pZCk6ICdcIiArIHRoaXMuY2hhdF9pZCArIFwiJ1wiKTtcclxuICAgIH1cclxuICAgIC8vIGZpbGVuYW1lIGlzIGNoYXRfaWRcclxuICAgIGNvbnN0IGNoYXRfZmlsZSA9IHRoaXMuY2hhdF9pZCArIFwiLmpzb25cIjtcclxuICAgIHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIud3JpdGUoXHJcbiAgICAgIFwiLnNtYXJ0LWNvbm5lY3Rpb25zL2NoYXRzL1wiICsgY2hhdF9maWxlLFxyXG4gICAgICBKU09OLnN0cmluZ2lmeSh0aGlzLnRocmVhZCwgbnVsbCwgMilcclxuICAgICk7XHJcbiAgfVxyXG4gIGFzeW5jIGxvYWRfY2hhdChjaGF0X2lkKSB7XHJcbiAgICB0aGlzLmNoYXRfaWQgPSBjaGF0X2lkO1xyXG4gICAgLy8gbG9hZCBjaGF0IGZyb20gZmlsZSBpbiAuc21hcnQtY29ubmVjdGlvbnMgZm9sZGVyXHJcbiAgICAvLyBmaWxlbmFtZSBpcyBjaGF0X2lkXHJcbiAgICBjb25zdCBjaGF0X2ZpbGUgPSB0aGlzLmNoYXRfaWQgKyBcIi5qc29uXCI7XHJcbiAgICAvLyByZWFkIGZpbGVcclxuICAgIGxldCBjaGF0X2pzb24gPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLnJlYWQoXHJcbiAgICAgIFwiLnNtYXJ0LWNvbm5lY3Rpb25zL2NoYXRzL1wiICsgY2hhdF9maWxlXHJcbiAgICApO1xyXG4gICAgLy8gcGFyc2UganNvblxyXG4gICAgdGhpcy50aHJlYWQgPSBKU09OLnBhcnNlKGNoYXRfanNvbik7XHJcbiAgICAvLyBsb2FkIGNoYXRfbWxcclxuICAgIHRoaXMuY2hhdF9tbCA9IHRoaXMucHJlcGFyZV9jaGF0X21sKCk7XHJcbiAgICAvLyByZW5kZXIgbWVzc2FnZXMgaW4gY2hhdCB2aWV3XHJcbiAgICAvLyBmb3IgZWFjaCB0dXJuIGluIGNoYXRfbWxcclxuICAgIC8vIGNvbnNvbGUubG9nKHRoaXMudGhyZWFkKTtcclxuICAgIC8vIGNvbnNvbGUubG9nKHRoaXMuY2hhdF9tbCk7XHJcbiAgfVxyXG4gIC8vIHByZXBhcmUgY2hhdF9tbCBmcm9tIGNoYXRcclxuICAvLyBnZXRzIHRoZSBsYXN0IG1lc3NhZ2Ugb2YgZWFjaCB0dXJuIHVubGVzcyB0dXJuX3ZhcmlhdGlvbl9vZmZzZXRzPVtbdHVybl9pbmRleCx2YXJpYXRpb25faW5kZXhdXSBpcyBzcGVjaWZpZWQgaW4gb2Zmc2V0XHJcbiAgcHJlcGFyZV9jaGF0X21sKHR1cm5fdmFyaWF0aW9uX29mZnNldHM9W10pIHtcclxuICAgIC8vIGlmIG5vIHR1cm5fdmFyaWF0aW9uX29mZnNldHMsIGdldCB0aGUgbGFzdCBtZXNzYWdlIG9mIGVhY2ggdHVyblxyXG4gICAgaWYodHVybl92YXJpYXRpb25fb2Zmc2V0cy5sZW5ndGggPT09IDApe1xyXG4gICAgICB0aGlzLmNoYXRfbWwgPSB0aGlzLnRocmVhZC5tYXAodHVybiA9PiB7XHJcbiAgICAgICAgcmV0dXJuIHR1cm5bdHVybi5sZW5ndGggLSAxXTtcclxuICAgICAgfSk7XHJcbiAgICB9ZWxzZXtcclxuICAgICAgLy8gY3JlYXRlIGFuIGFycmF5IGZyb20gdHVybl92YXJpYXRpb25fb2Zmc2V0cyB0aGF0IGluZGV4ZXMgdmFyaWF0aW9uX2luZGV4IGF0IHR1cm5faW5kZXhcclxuICAgICAgLy8gZXguIFtbMyw1XV0gPT4gW3VuZGVmaW5lZCwgdW5kZWZpbmVkLCB1bmRlZmluZWQsIDVdXHJcbiAgICAgIGxldCB0dXJuX3ZhcmlhdGlvbl9pbmRleCA9IFtdO1xyXG4gICAgICBmb3IobGV0IGkgPSAwOyBpIDwgdHVybl92YXJpYXRpb25fb2Zmc2V0cy5sZW5ndGg7IGkrKyl7XHJcbiAgICAgICAgdHVybl92YXJpYXRpb25faW5kZXhbdHVybl92YXJpYXRpb25fb2Zmc2V0c1tpXVswXV0gPSB0dXJuX3ZhcmlhdGlvbl9vZmZzZXRzW2ldWzFdO1xyXG4gICAgICB9XHJcbiAgICAgIC8vIGxvb3AgdGhyb3VnaCBjaGF0XHJcbiAgICAgIHRoaXMuY2hhdF9tbCA9IHRoaXMudGhyZWFkLm1hcCgodHVybiwgdHVybl9pbmRleCkgPT4ge1xyXG4gICAgICAgIC8vIGlmIHRoZXJlIGlzIGFuIGluZGV4IGZvciB0aGlzIHR1cm4sIHJldHVybiB0aGUgdmFyaWF0aW9uIGF0IHRoYXQgaW5kZXhcclxuICAgICAgICBpZih0dXJuX3ZhcmlhdGlvbl9pbmRleFt0dXJuX2luZGV4XSAhPT0gdW5kZWZpbmVkKXtcclxuICAgICAgICAgIHJldHVybiB0dXJuW3R1cm5fdmFyaWF0aW9uX2luZGV4W3R1cm5faW5kZXhdXTtcclxuICAgICAgICB9XHJcbiAgICAgICAgLy8gb3RoZXJ3aXNlIHJldHVybiB0aGUgbGFzdCBtZXNzYWdlIG9mIHRoZSB0dXJuXHJcbiAgICAgICAgcmV0dXJuIHR1cm5bdHVybi5sZW5ndGggLSAxXTtcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICAvLyBzdHJpcCBhbGwgYnV0IHJvbGUgYW5kIGNvbnRlbnQgcHJvcGVydGllcyBmcm9tIGVhY2ggbWVzc2FnZVxyXG4gICAgdGhpcy5jaGF0X21sID0gdGhpcy5jaGF0X21sLm1hcChtZXNzYWdlID0+IHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICByb2xlOiBtZXNzYWdlLnJvbGUsXHJcbiAgICAgICAgY29udGVudDogbWVzc2FnZS5jb250ZW50XHJcbiAgICAgIH07XHJcbiAgICB9KTtcclxuICAgIHJldHVybiB0aGlzLmNoYXRfbWw7XHJcbiAgfVxyXG4gIGxhc3QoKSB7XHJcbiAgICAvLyBnZXQgbGFzdCBtZXNzYWdlIGZyb20gY2hhdFxyXG4gICAgcmV0dXJuIHRoaXMudGhyZWFkW3RoaXMudGhyZWFkLmxlbmd0aCAtIDFdW3RoaXMudGhyZWFkW3RoaXMudGhyZWFkLmxlbmd0aCAtIDFdLmxlbmd0aCAtIDFdO1xyXG4gIH1cclxuICBsYXN0X2Zyb20oKSB7XHJcbiAgICByZXR1cm4gdGhpcy5sYXN0KCkucm9sZTtcclxuICB9XHJcbiAgLy8gcmV0dXJucyB1c2VyX2lucHV0IG9yIGNvbXBsZXRpb25cclxuICBsYXN0X21lc3NhZ2UoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5sYXN0KCkuY29udGVudDtcclxuICB9XHJcbiAgLy8gbWVzc2FnZT17fVxyXG4gIC8vIGFkZCBuZXcgbWVzc2FnZSB0byB0aHJlYWRcclxuICBuZXdfbWVzc2FnZV9pbl90aHJlYWQobWVzc2FnZSwgdHVybj0tMSkge1xyXG4gICAgLy8gaWYgdHVybiBpcyAtMSwgYWRkIHRvIG5ldyB0dXJuXHJcbiAgICBpZih0aGlzLmNvbnRleHQpe1xyXG4gICAgICBtZXNzYWdlLmNvbnRleHQgPSB0aGlzLmNvbnRleHQ7XHJcbiAgICAgIHRoaXMuY29udGV4dCA9IG51bGw7XHJcbiAgICB9XHJcbiAgICBpZih0aGlzLmh5ZCl7XHJcbiAgICAgIG1lc3NhZ2UuaHlkID0gdGhpcy5oeWQ7XHJcbiAgICAgIHRoaXMuaHlkID0gbnVsbDtcclxuICAgIH1cclxuICAgIGlmICh0dXJuID09PSAtMSkge1xyXG4gICAgICB0aGlzLnRocmVhZC5wdXNoKFttZXNzYWdlXSk7XHJcbiAgICB9ZWxzZXtcclxuICAgICAgLy8gb3RoZXJ3aXNlIGFkZCB0byBzcGVjaWZpZWQgdHVyblxyXG4gICAgICB0aGlzLnRocmVhZFt0dXJuXS5wdXNoKG1lc3NhZ2UpO1xyXG4gICAgfVxyXG4gIH1cclxuICByZXNldF9jb250ZXh0KCl7XHJcbiAgICB0aGlzLmNvbnRleHQgPSBudWxsO1xyXG4gICAgdGhpcy5oeWQgPSBudWxsO1xyXG4gIH1cclxuICBhc3luYyByZW5hbWVfY2hhdChuZXdfbmFtZSl7XHJcbiAgICAvLyBjaGVjayBpZiBjdXJyZW50IGNoYXRfaWQgZmlsZSBleGlzdHNcclxuICAgIGlmICh0aGlzLmNoYXRfaWQgJiYgYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci5leGlzdHMoXCIuc21hcnQtY29ubmVjdGlvbnMvY2hhdHMvXCIgKyB0aGlzLmNoYXRfaWQgKyBcIi5qc29uXCIpKSB7XHJcbiAgICAgIG5ld19uYW1lID0gdGhpcy5jaGF0X2lkLnJlcGxhY2UodGhpcy5uYW1lKCksIG5ld19uYW1lKTtcclxuICAgICAgLy8gcmVuYW1lIGZpbGUgaWYgaXQgZXhpc3RzXHJcbiAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIucmVuYW1lKFxyXG4gICAgICAgIFwiLnNtYXJ0LWNvbm5lY3Rpb25zL2NoYXRzL1wiICsgdGhpcy5jaGF0X2lkICsgXCIuanNvblwiLFxyXG4gICAgICAgIFwiLnNtYXJ0LWNvbm5lY3Rpb25zL2NoYXRzL1wiICsgbmV3X25hbWUgKyBcIi5qc29uXCJcclxuICAgICAgKTtcclxuICAgICAgLy8gc2V0IGNoYXRfaWQgdG8gbmV3X25hbWVcclxuICAgICAgdGhpcy5jaGF0X2lkID0gbmV3X25hbWU7XHJcbiAgICB9ZWxzZXtcclxuICAgICAgdGhpcy5jaGF0X2lkID0gbmV3X25hbWUgKyBcIlx1MjAxNFwiICsgdGhpcy5nZXRfZmlsZV9kYXRlX3N0cmluZygpO1xyXG4gICAgICAvLyBzYXZlIGNoYXRcclxuICAgICAgYXdhaXQgdGhpcy5zYXZlX2NoYXQoKTtcclxuICAgIH1cclxuXHJcbiAgfVxyXG5cclxuICBuYW1lKCkge1xyXG4gICAgaWYodGhpcy5jaGF0X2lkKXtcclxuICAgICAgLy8gcmVtb3ZlIGRhdGUgYWZ0ZXIgbGFzdCBlbSBkYXNoXHJcbiAgICAgIHJldHVybiB0aGlzLmNoYXRfaWQucmVwbGFjZSgvXHUyMDE0W15cdTIwMTRdKiQvLFwiXCIpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIFwiVU5USVRMRURcIjtcclxuICB9XHJcblxyXG4gIGdldF9maWxlX2RhdGVfc3RyaW5nKCkge1xyXG4gICAgcmV0dXJuIG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5yZXBsYWNlKC8oVHw6fFxcLi4qKS9nLCBcIiBcIikudHJpbSgpO1xyXG4gIH1cclxuICAvLyBnZXQgcmVzcG9uc2UgZnJvbSB3aXRoIG5vdGUgY29udGV4dFxyXG4gIGFzeW5jIGdldF9yZXNwb25zZV93aXRoX25vdGVfY29udGV4dCh1c2VyX2lucHV0LCBjaGF0X3ZpZXcpIHtcclxuICAgIGxldCBzeXN0ZW1faW5wdXQgPSBcIkltYWdpbmUgdGhlIGZvbGxvd2luZyBub3RlcyB3ZXJlIHdyaXR0ZW4gYnkgdGhlIHVzZXIgYW5kIGNvbnRhaW4gdGhlIG5lY2Vzc2FyeSBpbmZvcm1hdGlvbiB0byBzeW50aGVzaXplIGEgdXNlZnVsIGFuc3dlciB0aGUgdXNlcidzIHF1ZXJ5OlxcblwiO1xyXG4gICAgLy8gZXh0cmFjdCBpbnRlcm5hbCBsaW5rc1xyXG4gICAgY29uc3Qgbm90ZXMgPSB0aGlzLmV4dHJhY3RfaW50ZXJuYWxfbGlua3ModXNlcl9pbnB1dCk7XHJcbiAgICAvLyBnZXQgY29udGVudCBvZiBpbnRlcm5hbCBsaW5rcyBhcyBjb250ZXh0XHJcbiAgICBsZXQgbWF4X2NoYXJzID0gZ2V0X21heF9jaGFycyh0aGlzLnBsdWdpbi5zZXR0aW5ncy5zbWFydF9jaGF0X21vZGVsKTtcclxuICAgIGZvcihsZXQgaSA9IDA7IGkgPCBub3Rlcy5sZW5ndGg7IGkrKyl7XHJcbiAgICAgIC8vIG1heCBjaGFycyBmb3IgdGhpcyBub3RlIGlzIG1heF9jaGFycyBkaXZpZGVkIGJ5IG51bWJlciBvZiBub3RlcyBsZWZ0XHJcbiAgICAgIGNvbnN0IHRoaXNfbWF4X2NoYXJzID0gKG5vdGVzLmxlbmd0aCAtIGkgPiAxKSA/IE1hdGguZmxvb3IobWF4X2NoYXJzIC8gKG5vdGVzLmxlbmd0aCAtIGkpKSA6IG1heF9jaGFycztcclxuICAgICAgLy8gY29uc29sZS5sb2coXCJmaWxlIGNvbnRleHQgbWF4IGNoYXJzOiBcIiArIHRoaXNfbWF4X2NoYXJzKTtcclxuICAgICAgY29uc3Qgbm90ZV9jb250ZW50ID0gYXdhaXQgdGhpcy5nZXRfbm90ZV9jb250ZW50cyhub3Rlc1tpXSwge2NoYXJfbGltaXQ6IHRoaXNfbWF4X2NoYXJzfSk7XHJcbiAgICAgIHN5c3RlbV9pbnB1dCArPSBgLS0tQkVHSU4gTk9URTogW1ske25vdGVzW2ldLmJhc2VuYW1lfV1dLS0tXFxuYFxyXG4gICAgICBzeXN0ZW1faW5wdXQgKz0gbm90ZV9jb250ZW50O1xyXG4gICAgICBzeXN0ZW1faW5wdXQgKz0gYC0tLUVORCBOT1RFLS0tXFxuYFxyXG4gICAgICBtYXhfY2hhcnMgLT0gbm90ZV9jb250ZW50Lmxlbmd0aDtcclxuICAgICAgaWYobWF4X2NoYXJzIDw9IDApIGJyZWFrO1xyXG4gICAgfVxyXG4gICAgdGhpcy5jb250ZXh0ID0gc3lzdGVtX2lucHV0O1xyXG4gICAgY29uc3QgY2hhdG1sID0gW1xyXG4gICAgICB7XHJcbiAgICAgICAgcm9sZTogXCJzeXN0ZW1cIixcclxuICAgICAgICBjb250ZW50OiBzeXN0ZW1faW5wdXRcclxuICAgICAgfSxcclxuICAgICAge1xyXG4gICAgICAgIHJvbGU6IFwidXNlclwiLFxyXG4gICAgICAgIGNvbnRlbnQ6IHVzZXJfaW5wdXRcclxuICAgICAgfVxyXG4gICAgXTtcclxuICAgIGNoYXRfdmlldy5yZXF1ZXN0X2NoYXRncHRfY29tcGxldGlvbih7bWVzc2FnZXM6IGNoYXRtbCwgdGVtcGVyYXR1cmU6IDAsIHByaXZhY3lTdHI6ICdcdTVERjJcdTdFQ0ZcdThCRkJcdTUzRDZcdTdCMTRcdThCQjBcdTUxODVcdTVCQjknfSk7XHJcbiAgfVxyXG4gIC8vIGNoZWNrIGlmIGNvbnRhaW5zIGludGVybmFsIGxpbmtcclxuICBjb250YWluc19pbnRlcm5hbF9saW5rKHVzZXJfaW5wdXQpIHtcclxuICAgIGlmKHVzZXJfaW5wdXQuaW5kZXhPZihcIltbXCIpID09PSAtMSkgcmV0dXJuIGZhbHNlO1xyXG4gICAgaWYodXNlcl9pbnB1dC5pbmRleE9mKFwiXV1cIikgPT09IC0xKSByZXR1cm4gZmFsc2U7XHJcbiAgICByZXR1cm4gdHJ1ZTtcclxuICB9XHJcbiAgLy8gY2hlY2sgaWYgY29udGFpbnMgZm9sZGVyIHJlZmVyZW5jZSAoZXguIC9mb2xkZXIvLCBvciAvZm9sZGVyL3N1YmZvbGRlci8pXHJcbiAgY29udGFpbnNfZm9sZGVyX3JlZmVyZW5jZSh1c2VyX2lucHV0KSB7XHJcbiAgICBpZih1c2VyX2lucHV0LmluZGV4T2YoXCIvXCIpID09PSAtMSkgcmV0dXJuIGZhbHNlO1xyXG4gICAgaWYodXNlcl9pbnB1dC5pbmRleE9mKFwiL1wiKSA9PT0gdXNlcl9pbnB1dC5sYXN0SW5kZXhPZihcIi9cIikpIHJldHVybiBmYWxzZTtcclxuICAgIHJldHVybiB0cnVlO1xyXG4gIH1cclxuICAvLyBnZXQgZm9sZGVyIHJlZmVyZW5jZXMgZnJvbSB1c2VyIGlucHV0XHJcbiAgZ2V0X2ZvbGRlcl9yZWZlcmVuY2VzKHVzZXJfaW5wdXQpIHtcclxuICAgIC8vIHVzZSB0aGlzLmZvbGRlcnMgdG8gZXh0cmFjdCBmb2xkZXIgcmVmZXJlbmNlcyBieSBsb25nZXN0IGZpcnN0IChleC4gL2ZvbGRlci9zdWJmb2xkZXIvIGJlZm9yZSAvZm9sZGVyLykgdG8gYXZvaWQgbWF0Y2hpbmcgL2ZvbGRlci9zdWJmb2xkZXIvIGFzIC9mb2xkZXIvXHJcbiAgICBjb25zdCBmb2xkZXJzID0gdGhpcy5wbHVnaW4uZm9sZGVycy5zbGljZSgpOyAvLyBjb3B5IGZvbGRlcnMgYXJyYXlcclxuICAgIGNvbnN0IG1hdGNoZXMgPSBmb2xkZXJzLnNvcnQoKGEsIGIpID0+IGIubGVuZ3RoIC0gYS5sZW5ndGgpLm1hcChmb2xkZXIgPT4ge1xyXG4gICAgICAvLyBjaGVjayBpZiBmb2xkZXIgaXMgaW4gdXNlcl9pbnB1dFxyXG4gICAgICBpZih1c2VyX2lucHV0LmluZGV4T2YoZm9sZGVyKSAhPT0gLTEpe1xyXG4gICAgICAgIC8vIHJlbW92ZSBmb2xkZXIgZnJvbSB1c2VyX2lucHV0IHRvIHByZXZlbnQgbWF0Y2hpbmcgL2ZvbGRlci9zdWJmb2xkZXIvIGFzIC9mb2xkZXIvXHJcbiAgICAgICAgdXNlcl9pbnB1dCA9IHVzZXJfaW5wdXQucmVwbGFjZShmb2xkZXIsIFwiXCIpO1xyXG4gICAgICAgIHJldHVybiBmb2xkZXI7XHJcbiAgICAgIH1cclxuICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfSkuZmlsdGVyKGZvbGRlciA9PiBmb2xkZXIpO1xyXG4gICAgY29uc29sZS5sb2cobWF0Y2hlcyk7XHJcbiAgICAvLyByZXR1cm4gYXJyYXkgb2YgbWF0Y2hlc1xyXG4gICAgaWYobWF0Y2hlcykgcmV0dXJuIG1hdGNoZXM7XHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbiAgfVxyXG5cclxuXHJcbiAgLy8gZXh0cmFjdCBpbnRlcm5hbCBsaW5rc1xyXG4gIGV4dHJhY3RfaW50ZXJuYWxfbGlua3ModXNlcl9pbnB1dCkge1xyXG4gICAgY29uc3QgbWF0Y2hlcyA9IHVzZXJfaW5wdXQubWF0Y2goL1xcW1xcWyguKj8pXFxdXFxdL2cpO1xyXG4gICAgY29uc29sZS5sb2cobWF0Y2hlcyk7XHJcbiAgICAvLyByZXR1cm4gYXJyYXkgb2YgVEZpbGUgb2JqZWN0c1xyXG4gICAgaWYobWF0Y2hlcykgcmV0dXJuIG1hdGNoZXMubWFwKG1hdGNoID0+IHtcclxuICAgICAgcmV0dXJuIHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0Rmlyc3RMaW5rcGF0aERlc3QobWF0Y2gucmVwbGFjZShcIltbXCIsIFwiXCIpLnJlcGxhY2UoXCJdXVwiLCBcIlwiKSwgXCIvXCIpO1xyXG4gICAgfSk7XHJcbiAgICByZXR1cm4gW107XHJcbiAgfVxyXG4gIC8vIGdldCBjb250ZXh0IGZyb20gaW50ZXJuYWwgbGlua3NcclxuICBhc3luYyBnZXRfbm90ZV9jb250ZW50cyhub3RlLCBvcHRzPXt9KSB7XHJcbiAgICBvcHRzID0ge1xyXG4gICAgICBjaGFyX2xpbWl0OiAxMDAwMCxcclxuICAgICAgLi4ub3B0c1xyXG4gICAgfVxyXG4gICAgLy8gcmV0dXJuIGlmIG5vdGUgaXMgbm90IGEgZmlsZVxyXG4gICAgaWYoIShub3RlIGluc3RhbmNlb2YgT2JzaWRpYW4uVEZpbGUpKSByZXR1cm4gXCJcIjtcclxuICAgIC8vIGdldCBmaWxlIGNvbnRlbnRcclxuICAgIGxldCBmaWxlX2NvbnRlbnQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKG5vdGUpO1xyXG4gICAgLy8gY2hlY2sgaWYgY29udGFpbnMgZGF0YXZpZXcgY29kZSBibG9ja1xyXG4gICAgaWYoZmlsZV9jb250ZW50LmluZGV4T2YoXCJgYGBkYXRhdmlld1wiKSA+IC0xKXtcclxuICAgICAgLy8gaWYgY29udGFpbnMgZGF0YXZpZXcgY29kZSBibG9jayBnZXQgYWxsIGRhdGF2aWV3IGNvZGUgYmxvY2tzXHJcbiAgICAgIGZpbGVfY29udGVudCA9IGF3YWl0IHRoaXMucmVuZGVyX2RhdGF2aWV3X3F1ZXJpZXMoZmlsZV9jb250ZW50LCBub3RlLnBhdGgsIG9wdHMpO1xyXG4gICAgfVxyXG4gICAgZmlsZV9jb250ZW50ID0gZmlsZV9jb250ZW50LnN1YnN0cmluZygwLCBvcHRzLmNoYXJfbGltaXQpO1xyXG4gICAgLy8gY29uc29sZS5sb2coZmlsZV9jb250ZW50Lmxlbmd0aCk7XHJcbiAgICByZXR1cm4gZmlsZV9jb250ZW50O1xyXG4gIH1cclxuXHJcblxyXG4gIGFzeW5jIHJlbmRlcl9kYXRhdmlld19xdWVyaWVzKGZpbGVfY29udGVudCwgbm90ZV9wYXRoLCBvcHRzPXt9KSB7XHJcbiAgICBvcHRzID0ge1xyXG4gICAgICBjaGFyX2xpbWl0OiBudWxsLFxyXG4gICAgICAuLi5vcHRzXHJcbiAgICB9O1xyXG4gICAgLy8gdXNlIHdpbmRvdyB0byBnZXQgZGF0YXZpZXcgYXBpXHJcbiAgICBjb25zdCBkYXRhdmlld19hcGkgPSB3aW5kb3dbXCJEYXRhdmlld0FQSVwiXTtcclxuICAgIC8vIHNraXAgaWYgZGF0YXZpZXcgYXBpIG5vdCBmb3VuZFxyXG4gICAgaWYoIWRhdGF2aWV3X2FwaSkgcmV0dXJuIGZpbGVfY29udGVudDtcclxuICAgIGNvbnN0IGRhdGF2aWV3X2NvZGVfYmxvY2tzID0gZmlsZV9jb250ZW50Lm1hdGNoKC9gYGBkYXRhdmlldyguKj8pYGBgL2dzKTtcclxuICAgIC8vIGZvciBlYWNoIGRhdGF2aWV3IGNvZGUgYmxvY2tcclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGF0YXZpZXdfY29kZV9ibG9ja3MubGVuZ3RoOyBpKyspIHtcclxuICAgICAgLy8gaWYgb3B0cyBjaGFyX2xpbWl0IGlzIGxlc3MgdGhhbiBpbmRleE9mIGRhdGF2aWV3IGNvZGUgYmxvY2ssIGJyZWFrXHJcbiAgICAgIGlmKG9wdHMuY2hhcl9saW1pdCAmJiBvcHRzLmNoYXJfbGltaXQgPCBmaWxlX2NvbnRlbnQuaW5kZXhPZihkYXRhdmlld19jb2RlX2Jsb2Nrc1tpXSkpIGJyZWFrO1xyXG4gICAgICAvLyBnZXQgZGF0YXZpZXcgY29kZSBibG9ja1xyXG4gICAgICBjb25zdCBkYXRhdmlld19jb2RlX2Jsb2NrID0gZGF0YXZpZXdfY29kZV9ibG9ja3NbaV07XHJcbiAgICAgIC8vIGdldCBjb250ZW50IG9mIGRhdGF2aWV3IGNvZGUgYmxvY2tcclxuICAgICAgY29uc3QgZGF0YXZpZXdfY29kZV9ibG9ja19jb250ZW50ID0gZGF0YXZpZXdfY29kZV9ibG9jay5yZXBsYWNlKFwiYGBgZGF0YXZpZXdcIiwgXCJcIikucmVwbGFjZShcImBgYFwiLCBcIlwiKTtcclxuICAgICAgLy8gZ2V0IGRhdGF2aWV3IHF1ZXJ5IHJlc3VsdFxyXG4gICAgICBjb25zdCBkYXRhdmlld19xdWVyeV9yZXN1bHQgPSBhd2FpdCBkYXRhdmlld19hcGkucXVlcnlNYXJrZG93bihkYXRhdmlld19jb2RlX2Jsb2NrX2NvbnRlbnQsIG5vdGVfcGF0aCwgbnVsbCk7XHJcbiAgICAgIC8vIGlmIHF1ZXJ5IHJlc3VsdCBpcyBzdWNjZXNzZnVsLCByZXBsYWNlIGRhdGF2aWV3IGNvZGUgYmxvY2sgd2l0aCBxdWVyeSByZXN1bHRcclxuICAgICAgaWYgKGRhdGF2aWV3X3F1ZXJ5X3Jlc3VsdC5zdWNjZXNzZnVsKSB7XHJcbiAgICAgICAgZmlsZV9jb250ZW50ID0gZmlsZV9jb250ZW50LnJlcGxhY2UoZGF0YXZpZXdfY29kZV9ibG9jaywgZGF0YXZpZXdfcXVlcnlfcmVzdWx0LnZhbHVlKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIGZpbGVfY29udGVudDtcclxuICB9XHJcbn1cclxuXHJcbmNsYXNzIFNtYXJ0Q29ubmVjdGlvbnNDaGF0SGlzdG9yeU1vZGFsIGV4dGVuZHMgT2JzaWRpYW4uRnV6enlTdWdnZXN0TW9kYWwge1xyXG4gIGNvbnN0cnVjdG9yKGFwcCwgdmlldywgZmlsZXMpIHtcclxuICAgIHN1cGVyKGFwcCk7XHJcbiAgICB0aGlzLmFwcCA9IGFwcDtcclxuICAgIHRoaXMudmlldyA9IHZpZXc7XHJcbiAgICB0aGlzLnNldFBsYWNlaG9sZGVyKFwiVHlwZSB0aGUgbmFtZSBvZiBhIGNoYXQgc2Vzc2lvbi4uLlwiKTtcclxuICB9XHJcbiAgZ2V0SXRlbXMoKSB7XHJcbiAgICBpZiAoIXRoaXMudmlldy5maWxlcykge1xyXG4gICAgICByZXR1cm4gW107XHJcbiAgICB9XHJcbiAgICByZXR1cm4gdGhpcy52aWV3LmZpbGVzO1xyXG4gIH1cclxuICBnZXRJdGVtVGV4dChpdGVtKSB7XHJcbiAgICAvLyBpZiBub3QgVU5USVRMRUQsIHJlbW92ZSBkYXRlIGFmdGVyIGxhc3QgZW0gZGFzaFxyXG4gICAgaWYoaXRlbS5pbmRleE9mKFwiVU5USVRMRURcIikgPT09IC0xKXtcclxuICAgICAgaXRlbS5yZXBsYWNlKC9cdTIwMTRbXlx1MjAxNF0qJC8sXCJcIik7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gaXRlbTtcclxuICB9XHJcbiAgb25DaG9vc2VJdGVtKHNlc3Npb24pIHtcclxuICAgIHRoaXMudmlldy5vcGVuX2NoYXQoc2Vzc2lvbik7XHJcbiAgfVxyXG59XHJcblxyXG4vLyBGaWxlIFNlbGVjdCBGdXp6eSBTdWdnZXN0IE1vZGFsXHJcbmNsYXNzIFNtYXJ0Q29ubmVjdGlvbnNGaWxlU2VsZWN0TW9kYWwgZXh0ZW5kcyBPYnNpZGlhbi5GdXp6eVN1Z2dlc3RNb2RhbCB7XHJcbiAgY29uc3RydWN0b3IoYXBwLCB2aWV3KSB7XHJcbiAgICBzdXBlcihhcHApO1xyXG4gICAgdGhpcy5hcHAgPSBhcHA7XHJcbiAgICB0aGlzLnZpZXcgPSB2aWV3O1xyXG4gICAgdGhpcy5zZXRQbGFjZWhvbGRlcihcIlR5cGUgdGhlIG5hbWUgb2YgYSBmaWxlLi4uXCIpO1xyXG4gIH1cclxuICBnZXRJdGVtcygpIHtcclxuICAgIC8vIGdldCBhbGwgbWFya2Rvd24gZmlsZXNcclxuICAgIHJldHVybiB0aGlzLmFwcC52YXVsdC5nZXRNYXJrZG93bkZpbGVzKCkuc29ydCgoYSwgYikgPT4gYS5iYXNlbmFtZS5sb2NhbGVDb21wYXJlKGIuYmFzZW5hbWUpKTtcclxuICB9XHJcbiAgZ2V0SXRlbVRleHQoaXRlbSkge1xyXG4gICAgcmV0dXJuIGl0ZW0uYmFzZW5hbWU7XHJcbiAgfVxyXG4gIG9uQ2hvb3NlSXRlbShmaWxlKSB7XHJcbiAgICB0aGlzLnZpZXcuaW5zZXJ0X3NlbGVjdGlvbihmaWxlLmJhc2VuYW1lICsgXCJdXSBcIik7XHJcbiAgfVxyXG59XHJcbi8vIEZvbGRlciBTZWxlY3QgRnV6enkgU3VnZ2VzdCBNb2RhbFxyXG5jbGFzcyBTbWFydENvbm5lY3Rpb25zRm9sZGVyU2VsZWN0TW9kYWwgZXh0ZW5kcyBPYnNpZGlhbi5GdXp6eVN1Z2dlc3RNb2RhbCB7XHJcbiAgY29uc3RydWN0b3IoYXBwLCB2aWV3KSB7XHJcbiAgICBzdXBlcihhcHApO1xyXG4gICAgdGhpcy5hcHAgPSBhcHA7XHJcbiAgICB0aGlzLnZpZXcgPSB2aWV3O1xyXG4gICAgdGhpcy5zZXRQbGFjZWhvbGRlcihcIlR5cGUgdGhlIG5hbWUgb2YgYSBmb2xkZXIuLi5cIik7XHJcbiAgfVxyXG4gIGdldEl0ZW1zKCkge1xyXG4gICAgcmV0dXJuIHRoaXMudmlldy5wbHVnaW4uZm9sZGVycztcclxuICB9XHJcbiAgZ2V0SXRlbVRleHQoaXRlbSkge1xyXG4gICAgcmV0dXJuIGl0ZW07XHJcbiAgfVxyXG4gIG9uQ2hvb3NlSXRlbShmb2xkZXIpIHtcclxuICAgIHRoaXMudmlldy5pbnNlcnRfc2VsZWN0aW9uKGZvbGRlciArIFwiLyBcIik7XHJcbiAgfVxyXG59XHJcblxyXG5cclxuLy8gSGFuZGxlIEFQSSByZXNwb25zZSBzdHJlYW1pbmdcclxuY2xhc3MgU2NTdHJlYW1lciB7XHJcbiAgLy8gY29uc3RydWN0b3JcclxuICBjb25zdHJ1Y3Rvcih1cmwsIG9wdGlvbnMpIHtcclxuICAgIC8vIHNldCBkZWZhdWx0IG9wdGlvbnNcclxuICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xyXG4gICAgdGhpcy51cmwgPSB1cmw7XHJcbiAgICB0aGlzLm1ldGhvZCA9IG9wdGlvbnMubWV0aG9kIHx8ICdHRVQnO1xyXG4gICAgdGhpcy5oZWFkZXJzID0gb3B0aW9ucy5oZWFkZXJzIHx8IHt9O1xyXG4gICAgdGhpcy5wYXlsb2FkID0gb3B0aW9ucy5wYXlsb2FkIHx8IG51bGw7XHJcbiAgICB0aGlzLndpdGhDcmVkZW50aWFscyA9IG9wdGlvbnMud2l0aENyZWRlbnRpYWxzIHx8IGZhbHNlO1xyXG4gICAgdGhpcy5saXN0ZW5lcnMgPSB7fTtcclxuICAgIHRoaXMucmVhZHlTdGF0ZSA9IHRoaXMuQ09OTkVDVElORztcclxuICAgIHRoaXMucHJvZ3Jlc3MgPSAwO1xyXG4gICAgdGhpcy5jaHVuayA9ICcnO1xyXG4gICAgdGhpcy54aHIgPSBudWxsO1xyXG4gICAgdGhpcy5GSUVMRF9TRVBBUkFUT1IgPSAnOic7XHJcbiAgICB0aGlzLklOSVRJQUxJWklORyA9IC0xO1xyXG4gICAgdGhpcy5DT05ORUNUSU5HID0gMDtcclxuICAgIHRoaXMuT1BFTiA9IDE7XHJcbiAgICB0aGlzLkNMT1NFRCA9IDI7XHJcbiAgfVxyXG4gIC8vIGFkZEV2ZW50TGlzdGVuZXJcclxuICBhZGRFdmVudExpc3RlbmVyKHR5cGUsIGxpc3RlbmVyKSB7XHJcbiAgICAvLyBjaGVjayBpZiB0aGUgdHlwZSBpcyBpbiB0aGUgbGlzdGVuZXJzXHJcbiAgICBpZiAoIXRoaXMubGlzdGVuZXJzW3R5cGVdKSB7XHJcbiAgICAgIHRoaXMubGlzdGVuZXJzW3R5cGVdID0gW107XHJcbiAgICB9XHJcbiAgICAvLyBjaGVjayBpZiB0aGUgbGlzdGVuZXIgaXMgYWxyZWFkeSBpbiB0aGUgbGlzdGVuZXJzXHJcbiAgICBpZih0aGlzLmxpc3RlbmVyc1t0eXBlXS5pbmRleE9mKGxpc3RlbmVyKSA9PT0gLTEpIHtcclxuICAgICAgdGhpcy5saXN0ZW5lcnNbdHlwZV0ucHVzaChsaXN0ZW5lcik7XHJcbiAgICB9XHJcbiAgfVxyXG4gIC8vIHJlbW92ZUV2ZW50TGlzdGVuZXJcclxuICByZW1vdmVFdmVudExpc3RlbmVyKHR5cGUsIGxpc3RlbmVyKSB7XHJcbiAgICAvLyBjaGVjayBpZiBsaXN0ZW5lciB0eXBlIGlzIHVuZGVmaW5lZFxyXG4gICAgaWYgKCF0aGlzLmxpc3RlbmVyc1t0eXBlXSkge1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBsZXQgZmlsdGVyZWQgPSBbXTtcclxuICAgIC8vIGxvb3AgdGhyb3VnaCB0aGUgbGlzdGVuZXJzXHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMubGlzdGVuZXJzW3R5cGVdLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgIC8vIGNoZWNrIGlmIHRoZSBsaXN0ZW5lciBpcyB0aGUgc2FtZVxyXG4gICAgICBpZiAodGhpcy5saXN0ZW5lcnNbdHlwZV1baV0gIT09IGxpc3RlbmVyKSB7XHJcbiAgICAgICAgZmlsdGVyZWQucHVzaCh0aGlzLmxpc3RlbmVyc1t0eXBlXVtpXSk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIC8vIGNoZWNrIGlmIHRoZSBsaXN0ZW5lcnMgYXJlIGVtcHR5XHJcbiAgICBpZiAodGhpcy5saXN0ZW5lcnNbdHlwZV0ubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgIGRlbGV0ZSB0aGlzLmxpc3RlbmVyc1t0eXBlXTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIHRoaXMubGlzdGVuZXJzW3R5cGVdID0gZmlsdGVyZWQ7XHJcbiAgICB9XHJcbiAgfVxyXG4gIC8vIGRpc3BhdGNoRXZlbnRcclxuICBkaXNwYXRjaEV2ZW50KGV2ZW50KSB7XHJcbiAgICAvLyBpZiBubyBldmVudCByZXR1cm4gdHJ1ZVxyXG4gICAgaWYgKCFldmVudCkge1xyXG4gICAgICByZXR1cm4gdHJ1ZTtcclxuICAgIH1cclxuICAgIC8vIHNldCBldmVudCBzb3VyY2UgdG8gdGhpc1xyXG4gICAgZXZlbnQuc291cmNlID0gdGhpcztcclxuICAgIC8vIHNldCBvbkhhbmRsZXIgdG8gb24gKyBldmVudCB0eXBlXHJcbiAgICBsZXQgb25IYW5kbGVyID0gJ29uJyArIGV2ZW50LnR5cGU7XHJcbiAgICAvLyBjaGVjayBpZiB0aGUgb25IYW5kbGVyIGhhcyBvd24gcHJvcGVydHkgbmFtZWQgc2FtZSBhcyBvbkhhbmRsZXJcclxuICAgIGlmICh0aGlzLmhhc093blByb3BlcnR5KG9uSGFuZGxlcikpIHtcclxuICAgICAgLy8gY2FsbCB0aGUgb25IYW5kbGVyXHJcbiAgICAgIHRoaXNbb25IYW5kbGVyXS5jYWxsKHRoaXMsIGV2ZW50KTtcclxuICAgICAgLy8gY2hlY2sgaWYgdGhlIGV2ZW50IGlzIGRlZmF1bHQgcHJldmVudGVkXHJcbiAgICAgIGlmIChldmVudC5kZWZhdWx0UHJldmVudGVkKSB7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICAvLyBjaGVjayBpZiB0aGUgZXZlbnQgdHlwZSBpcyBpbiB0aGUgbGlzdGVuZXJzXHJcbiAgICBpZiAodGhpcy5saXN0ZW5lcnNbZXZlbnQudHlwZV0pIHtcclxuICAgICAgcmV0dXJuIHRoaXMubGlzdGVuZXJzW2V2ZW50LnR5cGVdLmV2ZXJ5KGZ1bmN0aW9uKGNhbGxiYWNrKSB7XHJcbiAgICAgICAgY2FsbGJhY2soZXZlbnQpO1xyXG4gICAgICAgIHJldHVybiAhZXZlbnQuZGVmYXVsdFByZXZlbnRlZDtcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gdHJ1ZTtcclxuICB9XHJcbiAgLy8gX3NldFJlYWR5U3RhdGVcclxuICBfc2V0UmVhZHlTdGF0ZShzdGF0ZSkge1xyXG4gICAgLy8gc2V0IGV2ZW50IHR5cGUgdG8gcmVhZHlTdGF0ZUNoYW5nZVxyXG4gICAgbGV0IGV2ZW50ID0gbmV3IEN1c3RvbUV2ZW50KCdyZWFkeVN0YXRlQ2hhbmdlJyk7XHJcbiAgICAvLyBzZXQgZXZlbnQgcmVhZHlTdGF0ZSB0byBzdGF0ZVxyXG4gICAgZXZlbnQucmVhZHlTdGF0ZSA9IHN0YXRlO1xyXG4gICAgLy8gc2V0IHJlYWR5U3RhdGUgdG8gc3RhdGVcclxuICAgIHRoaXMucmVhZHlTdGF0ZSA9IHN0YXRlO1xyXG4gICAgLy8gZGlzcGF0Y2ggZXZlbnRcclxuICAgIHRoaXMuZGlzcGF0Y2hFdmVudChldmVudCk7XHJcbiAgfVxyXG4gIC8vIF9vblN0cmVhbUZhaWx1cmVcclxuICBfb25TdHJlYW1GYWlsdXJlKGUpIHtcclxuICAgIC8vIHNldCBldmVudCB0eXBlIHRvIGVycm9yXHJcbiAgICBsZXQgZXZlbnQgPSBuZXcgQ3VzdG9tRXZlbnQoJ2Vycm9yJyk7XHJcbiAgICAvLyBzZXQgZXZlbnQgZGF0YSB0byBlXHJcbiAgICBldmVudC5kYXRhID0gZS5jdXJyZW50VGFyZ2V0LnJlc3BvbnNlO1xyXG4gICAgLy8gZGlzcGF0Y2ggZXZlbnRcclxuICAgIHRoaXMuZGlzcGF0Y2hFdmVudChldmVudCk7XHJcbiAgICB0aGlzLmNsb3NlKCk7XHJcbiAgfVxyXG4gIC8vIF9vblN0cmVhbUFib3J0XHJcbiAgX29uU3RyZWFtQWJvcnQoZSkge1xyXG4gICAgLy8gc2V0IHRvIGFib3J0XHJcbiAgICBsZXQgZXZlbnQgPSBuZXcgQ3VzdG9tRXZlbnQoJ2Fib3J0Jyk7XHJcbiAgICAvLyBjbG9zZVxyXG4gICAgdGhpcy5jbG9zZSgpO1xyXG4gIH1cclxuICAvLyBfb25TdHJlYW1Qcm9ncmVzc1xyXG4gIF9vblN0cmVhbVByb2dyZXNzKGUpIHtcclxuICAgIC8vIGlmIG5vdCB4aHIgcmV0dXJuXHJcbiAgICBpZiAoIXRoaXMueGhyKSB7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIC8vIGlmIHhociBzdGF0dXMgaXMgbm90IDIwMCByZXR1cm5cclxuICAgIGlmICh0aGlzLnhoci5zdGF0dXMgIT09IDIwMCkge1xyXG4gICAgICAvLyBvblN0cmVhbUZhaWx1cmVcclxuICAgICAgdGhpcy5fb25TdHJlYW1GYWlsdXJlKGUpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICAvLyBpZiByZWFkeSBzdGF0ZSBpcyBDT05ORUNUSU5HXHJcbiAgICBpZiAodGhpcy5yZWFkeVN0YXRlID09PSB0aGlzLkNPTk5FQ1RJTkcpIHtcclxuICAgICAgLy8gZGlzcGF0Y2ggZXZlbnRcclxuICAgICAgdGhpcy5kaXNwYXRjaEV2ZW50KG5ldyBDdXN0b21FdmVudCgnb3BlbicpKTtcclxuICAgICAgLy8gc2V0IHJlYWR5IHN0YXRlIHRvIE9QRU5cclxuICAgICAgdGhpcy5fc2V0UmVhZHlTdGF0ZSh0aGlzLk9QRU4pO1xyXG4gICAgfVxyXG4gICAgLy8gcGFyc2UgdGhlIHJlY2VpdmVkIGRhdGEuXHJcbiAgICBsZXQgZGF0YSA9IHRoaXMueGhyLnJlc3BvbnNlVGV4dC5zdWJzdHJpbmcodGhpcy5wcm9ncmVzcyk7XHJcbiAgICAvLyB1cGRhdGUgcHJvZ3Jlc3NcclxuICAgIHRoaXMucHJvZ3Jlc3MgKz0gZGF0YS5sZW5ndGg7XHJcbiAgICAvLyBzcGxpdCB0aGUgZGF0YSBieSBuZXcgbGluZSBhbmQgcGFyc2UgZWFjaCBsaW5lXHJcbiAgICBkYXRhLnNwbGl0KC8oXFxyXFxufFxccnxcXG4pezJ9L2cpLmZvckVhY2goZnVuY3Rpb24ocGFydCl7XHJcbiAgICAgIGlmKHBhcnQudHJpbSgpLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgIHRoaXMuZGlzcGF0Y2hFdmVudCh0aGlzLl9wYXJzZUV2ZW50Q2h1bmsodGhpcy5jaHVuay50cmltKCkpKTtcclxuICAgICAgICB0aGlzLmNodW5rID0gJyc7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdGhpcy5jaHVuayArPSBwYXJ0O1xyXG4gICAgICB9XHJcbiAgICB9LmJpbmQodGhpcykpO1xyXG4gIH1cclxuICAvLyBfb25TdHJlYW1Mb2FkZWRcclxuICBfb25TdHJlYW1Mb2FkZWQoZSkge1xyXG4gICAgdGhpcy5fb25TdHJlYW1Qcm9ncmVzcyhlKTtcclxuICAgIC8vIHBhcnNlIHRoZSBsYXN0IGNodW5rXHJcbiAgICB0aGlzLmRpc3BhdGNoRXZlbnQodGhpcy5fcGFyc2VFdmVudENodW5rKHRoaXMuY2h1bmspKTtcclxuICAgIHRoaXMuY2h1bmsgPSAnJztcclxuICB9XHJcbiAgLy8gX3BhcnNlRXZlbnRDaHVua1xyXG4gIF9wYXJzZUV2ZW50Q2h1bmsoY2h1bmspIHtcclxuICAgIC8vIGlmIG5vIGNodW5rIG9yIGNodW5rIGlzIGVtcHR5IHJldHVyblxyXG4gICAgaWYgKCFjaHVuayB8fCBjaHVuay5sZW5ndGggPT09IDApIHtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgICAvLyBpbml0IGVcclxuICAgIGxldCBlID0ge2lkOiBudWxsLCByZXRyeTogbnVsbCwgZGF0YTogJycsIGV2ZW50OiAnbWVzc2FnZSd9O1xyXG4gICAgLy8gc3BsaXQgdGhlIGNodW5rIGJ5IG5ldyBsaW5lXHJcbiAgICBjaHVuay5zcGxpdCgvKFxcclxcbnxcXHJ8XFxuKS8pLmZvckVhY2goZnVuY3Rpb24obGluZSkge1xyXG4gICAgICBsaW5lID0gbGluZS50cmltUmlnaHQoKTtcclxuICAgICAgbGV0IGluZGV4ID0gbGluZS5pbmRleE9mKHRoaXMuRklFTERfU0VQQVJBVE9SKTtcclxuICAgICAgaWYoaW5kZXggPD0gMCkge1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG4gICAgICAvLyBmaWVsZFxyXG4gICAgICBsZXQgZmllbGQgPSBsaW5lLnN1YnN0cmluZygwLCBpbmRleCk7XHJcbiAgICAgIGlmKCEoZmllbGQgaW4gZSkpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuICAgICAgLy8gdmFsdWVcclxuICAgICAgbGV0IHZhbHVlID0gbGluZS5zdWJzdHJpbmcoaW5kZXggKyAxKS50cmltTGVmdCgpO1xyXG4gICAgICBpZihmaWVsZCA9PT0gJ2RhdGEnKSB7XHJcbiAgICAgICAgZVtmaWVsZF0gKz0gdmFsdWU7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgZVtmaWVsZF0gPSB2YWx1ZTtcclxuICAgICAgfVxyXG4gICAgfS5iaW5kKHRoaXMpKTtcclxuICAgIC8vIHJldHVybiBldmVudFxyXG4gICAgbGV0IGV2ZW50ID0gbmV3IEN1c3RvbUV2ZW50KGUuZXZlbnQpO1xyXG4gICAgZXZlbnQuZGF0YSA9IGUuZGF0YTtcclxuICAgIGV2ZW50LmlkID0gZS5pZDtcclxuICAgIHJldHVybiBldmVudDtcclxuICB9XHJcbiAgLy8gX2NoZWNrU3RyZWFtQ2xvc2VkXHJcbiAgX2NoZWNrU3RyZWFtQ2xvc2VkKCkge1xyXG4gICAgaWYoIXRoaXMueGhyKSB7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGlmKHRoaXMueGhyLnJlYWR5U3RhdGUgPT09IFhNTEh0dHBSZXF1ZXN0LkRPTkUpIHtcclxuICAgICAgdGhpcy5fc2V0UmVhZHlTdGF0ZSh0aGlzLkNMT1NFRCk7XHJcbiAgICB9XHJcbiAgfVxyXG4gIC8vIHN0cmVhbVxyXG4gIHN0cmVhbSgpIHtcclxuICAgIC8vIHNldCByZWFkeSBzdGF0ZSB0byBjb25uZWN0aW5nXHJcbiAgICB0aGlzLl9zZXRSZWFkeVN0YXRlKHRoaXMuQ09OTkVDVElORyk7XHJcbiAgICAvLyBzZXQgeGhyIHRvIG5ldyBYTUxIdHRwUmVxdWVzdFxyXG4gICAgdGhpcy54aHIgPSBuZXcgWE1MSHR0cFJlcXVlc3QoKTtcclxuICAgIC8vIHNldCB4aHIgcHJvZ3Jlc3MgdG8gX29uU3RyZWFtUHJvZ3Jlc3NcclxuICAgIHRoaXMueGhyLmFkZEV2ZW50TGlzdGVuZXIoJ3Byb2dyZXNzJywgdGhpcy5fb25TdHJlYW1Qcm9ncmVzcy5iaW5kKHRoaXMpKTtcclxuICAgIC8vIHNldCB4aHIgbG9hZCB0byBfb25TdHJlYW1Mb2FkZWRcclxuICAgIHRoaXMueGhyLmFkZEV2ZW50TGlzdGVuZXIoJ2xvYWQnLCB0aGlzLl9vblN0cmVhbUxvYWRlZC5iaW5kKHRoaXMpKTtcclxuICAgIC8vIHNldCB4aHIgcmVhZHkgc3RhdGUgY2hhbmdlIHRvIF9jaGVja1N0cmVhbUNsb3NlZFxyXG4gICAgdGhpcy54aHIuYWRkRXZlbnRMaXN0ZW5lcigncmVhZHlzdGF0ZWNoYW5nZScsIHRoaXMuX2NoZWNrU3RyZWFtQ2xvc2VkLmJpbmQodGhpcykpO1xyXG4gICAgLy8gc2V0IHhociBlcnJvciB0byBfb25TdHJlYW1GYWlsdXJlXHJcbiAgICB0aGlzLnhoci5hZGRFdmVudExpc3RlbmVyKCdlcnJvcicsIHRoaXMuX29uU3RyZWFtRmFpbHVyZS5iaW5kKHRoaXMpKTtcclxuICAgIC8vIHNldCB4aHIgYWJvcnQgdG8gX29uU3RyZWFtQWJvcnRcclxuICAgIHRoaXMueGhyLmFkZEV2ZW50TGlzdGVuZXIoJ2Fib3J0JywgdGhpcy5fb25TdHJlYW1BYm9ydC5iaW5kKHRoaXMpKTtcclxuICAgIC8vIG9wZW4geGhyXHJcbiAgICB0aGlzLnhoci5vcGVuKHRoaXMubWV0aG9kLCB0aGlzLnVybCk7XHJcbiAgICAvLyBoZWFkZXJzIHRvIHhoclxyXG4gICAgZm9yIChsZXQgaGVhZGVyIGluIHRoaXMuaGVhZGVycykge1xyXG4gICAgICB0aGlzLnhoci5zZXRSZXF1ZXN0SGVhZGVyKGhlYWRlciwgdGhpcy5oZWFkZXJzW2hlYWRlcl0pO1xyXG4gICAgfVxyXG4gICAgLy8gY3JlZGVudGlhbHMgdG8geGhyXHJcbiAgICB0aGlzLnhoci53aXRoQ3JlZGVudGlhbHMgPSB0aGlzLndpdGhDcmVkZW50aWFscztcclxuICAgIC8vIHNlbmQgeGhyXHJcbiAgICB0aGlzLnhoci5zZW5kKHRoaXMucGF5bG9hZCk7XHJcbiAgfVxyXG4gIC8vIGNsb3NlXHJcbiAgY2xvc2UoKSB7XHJcbiAgICBpZih0aGlzLnJlYWR5U3RhdGUgPT09IHRoaXMuQ0xPU0VEKSB7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIHRoaXMueGhyLmFib3J0KCk7XHJcbiAgICB0aGlzLnhociA9IG51bGw7XHJcbiAgICB0aGlzLl9zZXRSZWFkeVN0YXRlKHRoaXMuQ0xPU0VEKTtcclxuICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gU21hcnRDb25uZWN0aW9uc1BsdWdpbjsiXSwKICAibWFw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
