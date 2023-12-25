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
  language: "en",
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
var SMART_TRANSLATION = {
  "en": {
    "pronous": ["my", "I", "me", "mine", "our", "ours", "us", "we"],
    "prompt": "Based on your notes",
    "initial_message": "Hi, I'm ChatGPT with access to your notes via Smart Connections. Ask me a question about your notes and I'll try to answer it."
  },
  "es": {
    "pronous": ["mi", "yo", "m\xED", "t\xFA"],
    "prompt": "Bas\xE1ndose en sus notas",
    "initial_message": "Hola, soy ChatGPT con acceso a tus apuntes a trav\xE9s de Smart Connections. Hazme una pregunta sobre tus apuntes e intentar\xE9 responderte."
  },
  "fr": {
    "pronous": ["me", "mon", "ma", "mes", "moi", "nous", "notre", "nos", "je", "j'", "m'"],
    "prompt": "D'apr\xE8s vos notes",
    "initial_message": "Bonjour, je suis ChatGPT et j'ai acc\xE8s \xE0 vos notes via Smart Connections. Posez-moi une question sur vos notes et j'essaierai d'y r\xE9pondre."
  },
  "de": {
    "pronous": ["mein", "meine", "meinen", "meiner", "meines", "mir", "uns", "unser", "unseren", "unserer", "unseres"],
    "prompt": "Basierend auf Ihren Notizen",
    "initial_message": "Hallo, ich bin ChatGPT und habe \xFCber Smart Connections Zugang zu Ihren Notizen. Stellen Sie mir eine Frage zu Ihren Notizen und ich werde versuchen, sie zu beantworten."
  },
  "it": {
    "pronous": ["mio", "mia", "miei", "mie", "noi", "nostro", "nostri", "nostra", "nostre"],
    "prompt": "Sulla base degli appunti",
    "initial_message": "Ciao, sono ChatGPT e ho accesso ai tuoi appunti tramite Smart Connections. Fatemi una domanda sui vostri appunti e cercher\xF2 di rispondervi."
  }
};
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
    this.self_ref_kw_regex = null;
    this.update_available = false;
  }
  async onload() {
    this.app.workspace.onLayoutReady(this.initialize.bind(this));
  }
  onunload() {
    this.output_render_log();
    console.log("unloading plugin");
    this.app.workspace.detachLeavesOfType(SMART_CONNECTIONS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(SMART_CONNECTIONS_CHAT_VIEW_TYPE);
  }
  async initialize() {
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
    this.self_ref_kw_regex = new RegExp(`\\b(${SMART_TRANSLATION[this.settings.language].pronous.join("|")})\\b`, "gi");
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
    new Obsidian.Notice("Smart Connections: embeddings file Force Refreshed, making new connections...");
    await this.smart_vec_lite.force_refresh();
    await this.get_all_embeddings();
    this.output_render_log();
    new Obsidian.Notice("Smart Connections: embeddings file Force Refreshed, new connections made.");
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
          return "excluded";
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
        return "Error getting embeddings for: " + current_note.path;
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
    this.set_message("Loading embeddings file...");
    const vecs_intiated = await this.plugin.init_vecs();
    if (vecs_intiated) {
      this.set_message("Embeddings file loaded.");
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
      this.set_message("An OpenAI API key is required to make Smart Connections");
      return;
    }
    if (!this.plugin.embeddings_loaded) {
      await this.plugin.init_vecs();
    }
    if (!this.plugin.embeddings_loaded) {
      console.log("embeddings files still not loaded or yet to be created");
      this.render_embeddings_buttons();
      return;
    }
    this.set_message("Making Smart Connections...");
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
            this.set_message("No active file");
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
          this.set_message("Making Smart Connections..." + this.interval_count);
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
    containerEl.createEl("h2", {
      text: "Supporter Settings"
    });
    containerEl.createEl("p", {
      text: 'As a Smart Connections "Supporter", fast-track your PKM journey with priority perks and pioneering innovations.'
    });
    const supporter_benefits_list = containerEl.createEl("ul");
    supporter_benefits_list.createEl("li", {
      text: "Enjoy swift, top-priority support."
    });
    supporter_benefits_list.createEl("li", {
      text: "Gain early access to experimental features like the ChatGPT plugin."
    });
    supporter_benefits_list.createEl("li", {
      text: "Stay informed and engaged with exclusive supporter-only communications."
    });
    new Obsidian.Setting(containerEl).setName("Supporter License Key").setDesc("Note: this is not required to use Smart Connections.").addText((text) => text.setPlaceholder("Enter your license_key").setValue(this.plugin.settings.license_key).onChange(async (value) => {
      this.plugin.settings.license_key = value.trim();
      await this.plugin.saveSettings(true);
    }));
    new Obsidian.Setting(containerEl).setName("Sync Notes").setDesc("Make notes available via the Smart Connections ChatGPT Plugin. Respects exclusion settings configured below.").addButton((button) => button.setButtonText("Sync Notes").onClick(async () => {
      await this.plugin.sync_notes();
    }));
    new Obsidian.Setting(containerEl).setName("Become a Supporter").setDesc("Become a Supporter").addButton((button) => button.setButtonText("Become a Supporter").onClick(async () => {
      const payment_pages = [
        "https://buy.stripe.com/9AQ5kO5QnbAWgGAbIY",
        "https://buy.stripe.com/9AQ7sWemT48u1LGcN4"
      ];
      if (!this.plugin.payment_page_index) {
        this.plugin.payment_page_index = Math.round(Math.random());
      }
      window.open(payment_pages[this.plugin.payment_page_index]);
    }));
    containerEl.createEl("h2", {
      text: "OpenAI Settings"
    });
    new Obsidian.Setting(containerEl).setName("OpenAI API Key").setDesc("Required: an OpenAI API key is currently required to use Smart Connections.").addText((text) => text.setPlaceholder("Enter your api_key").setValue(this.plugin.settings.api_key).onChange(async (value) => {
      this.plugin.settings.api_key = value.trim();
      await this.plugin.saveSettings(true);
    }));
    new Obsidian.Setting(containerEl).setName("OpenAI API Endpoint").setDesc("Optional: an OpenAI API endpoint is used to use Smart Connections.").addText((text) => text.setPlaceholder("Enter your api_endpoint").setValue(this.plugin.settings.api_endpoint).onChange(async (value) => {
      this.plugin.settings.api_endpoint = value.trim();
      await this.plugin.saveSettings(true);
    }));
    new Obsidian.Setting(containerEl).setName("Test API Key").setDesc("Test API Key").addButton((button) => button.setButtonText("Test API Key").onClick(async () => {
      const resp = await this.plugin.test_api_key();
      if (resp) {
        new Obsidian.Notice("Smart Connections: API key is valid");
      } else {
        new Obsidian.Notice("Smart Connections: API key is not working as expected!");
      }
    }));
    new Obsidian.Setting(containerEl).setName("Smart Chat Model").setDesc("Select a model to use with Smart Chat.").addDropdown((dropdown) => {
      dropdown.addOption("gpt-3.5-turbo-16k", "gpt-3.5-turbo-16k");
      dropdown.addOption("gpt-4", "gpt-4 (limited access, 8k)");
      dropdown.addOption("gpt-3.5-turbo", "gpt-3.5-turbo (4k)");
      dropdown.addOption("gpt-4-1106-preview", "gpt-4-turbo (128k)");
      dropdown.onChange(async (value) => {
        this.plugin.settings.smart_chat_model = value;
        await this.plugin.saveSettings();
      });
      dropdown.setValue(this.plugin.settings.smart_chat_model);
    });
    new Obsidian.Setting(containerEl).setName("Default Language").setDesc("Default language to use for Smart Chat. Changes which self-referential pronouns will trigger lookup of your notes.").addDropdown((dropdown) => {
      const languages = Object.keys(SMART_TRANSLATION);
      for (let i = 0; i < languages.length; i++) {
        dropdown.addOption(languages[i], languages[i]);
      }
      dropdown.onChange(async (value) => {
        this.plugin.settings.language = value;
        await this.plugin.saveSettings();
        self_ref_pronouns_list.setText(this.get_self_ref_list());
        const chat_view = this.app.workspace.getLeavesOfType(SMART_CONNECTIONS_CHAT_VIEW_TYPE).length > 0 ? this.app.workspace.getLeavesOfType(SMART_CONNECTIONS_CHAT_VIEW_TYPE)[0].view : null;
        if (chat_view) {
          chat_view.new_chat();
        }
      });
      dropdown.setValue(this.plugin.settings.language);
    });
    const self_ref_pronouns_list = containerEl.createEl("span", {
      text: this.get_self_ref_list()
    });
    containerEl.createEl("h2", {
      text: "Exclusions"
    });
    new Obsidian.Setting(containerEl).setName("file_exclusions").setDesc("'Excluded file' matchers separated by a comma.").addText((text) => text.setPlaceholder("drawings,prompts/logs").setValue(this.plugin.settings.file_exclusions).onChange(async (value) => {
      this.plugin.settings.file_exclusions = value;
      await this.plugin.saveSettings();
    }));
    new Obsidian.Setting(containerEl).setName("folder_exclusions").setDesc("'Excluded folder' matchers separated by a comma.").addText((text) => text.setPlaceholder("drawings,prompts/logs").setValue(this.plugin.settings.folder_exclusions).onChange(async (value) => {
      this.plugin.settings.folder_exclusions = value;
      await this.plugin.saveSettings();
    }));
    new Obsidian.Setting(containerEl).setName("path_only").setDesc("'Path only' matchers separated by a comma.").addText((text) => text.setPlaceholder("drawings,prompts/logs").setValue(this.plugin.settings.path_only).onChange(async (value) => {
      this.plugin.settings.path_only = value;
      await this.plugin.saveSettings();
    }));
    new Obsidian.Setting(containerEl).setName("header_exclusions").setDesc("'Excluded header' matchers separated by a comma. Works for 'blocks' only.").addText((text) => text.setPlaceholder("drawings,prompts/logs").setValue(this.plugin.settings.header_exclusions).onChange(async (value) => {
      this.plugin.settings.header_exclusions = value;
      await this.plugin.saveSettings();
    }));
    containerEl.createEl("h2", {
      text: "Display"
    });
    new Obsidian.Setting(containerEl).setName("show_full_path").setDesc("Show full path in view.").addToggle((toggle) => toggle.setValue(this.plugin.settings.show_full_path).onChange(async (value) => {
      this.plugin.settings.show_full_path = value;
      await this.plugin.saveSettings(true);
    }));
    new Obsidian.Setting(containerEl).setName("expanded_view").setDesc("Expanded view by default.").addToggle((toggle) => toggle.setValue(this.plugin.settings.expanded_view).onChange(async (value) => {
      this.plugin.settings.expanded_view = value;
      await this.plugin.saveSettings(true);
    }));
    new Obsidian.Setting(containerEl).setName("group_nearest_by_file").setDesc("Group nearest by file.").addToggle((toggle) => toggle.setValue(this.plugin.settings.group_nearest_by_file).onChange(async (value) => {
      this.plugin.settings.group_nearest_by_file = value;
      await this.plugin.saveSettings(true);
    }));
    new Obsidian.Setting(containerEl).setName("view_open").setDesc("Open view on Obsidian startup.").addToggle((toggle) => toggle.setValue(this.plugin.settings.view_open).onChange(async (value) => {
      this.plugin.settings.view_open = value;
      await this.plugin.saveSettings(true);
    }));
    new Obsidian.Setting(containerEl).setName("chat_open").setDesc("Open view on Obsidian startup.").addToggle((toggle) => toggle.setValue(this.plugin.settings.chat_open).onChange(async (value) => {
      this.plugin.settings.chat_open = value;
      await this.plugin.saveSettings(true);
    }));
    containerEl.createEl("h2", {
      text: "Advanced"
    });
    new Obsidian.Setting(containerEl).setName("log_render").setDesc("Log render details to console (includes token_usage).").addToggle((toggle) => toggle.setValue(this.plugin.settings.log_render).onChange(async (value) => {
      this.plugin.settings.log_render = value;
      await this.plugin.saveSettings(true);
    }));
    new Obsidian.Setting(containerEl).setName("log_render_files").setDesc("Log embedded objects paths with log render (for debugging).").addToggle((toggle) => toggle.setValue(this.plugin.settings.log_render_files).onChange(async (value) => {
      this.plugin.settings.log_render_files = value;
      await this.plugin.saveSettings(true);
    }));
    new Obsidian.Setting(containerEl).setName("skip_sections").setDesc("Skips making connections to specific sections within notes. Warning: reduces usefulness for large files and requires 'Force Refresh' for sections to work in the future.").addToggle((toggle) => toggle.setValue(this.plugin.settings.skip_sections).onChange(async (value) => {
      this.plugin.settings.skip_sections = value;
      await this.plugin.saveSettings(true);
    }));
    containerEl.createEl("h3", {
      text: "Test File Writing"
    });
    containerEl.createEl("h3", {
      text: "Manual Save"
    });
    let manual_save_results = containerEl.createEl("div");
    new Obsidian.Setting(containerEl).setName("manual_save").setDesc("Save current embeddings").addButton((button) => button.setButtonText("Manual Save").onClick(async () => {
      if (confirm("Are you sure you want to save your current embeddings?")) {
        try {
          await this.plugin.save_embeddings_to_file(true);
          manual_save_results.innerHTML = "Embeddings saved successfully.";
        } catch (e) {
          manual_save_results.innerHTML = "Embeddings failed to save. Error: " + e;
        }
      }
    }));
    containerEl.createEl("h3", {
      text: "Previously failed files"
    });
    let failed_list = containerEl.createEl("div");
    this.draw_failed_files_list(failed_list);
    containerEl.createEl("h3", {
      text: "Force Refresh"
    });
    new Obsidian.Setting(containerEl).setName("force_refresh").setDesc("WARNING: DO NOT use unless you know what you are doing! This will delete all of your current embeddings from OpenAI and trigger reprocessing of your entire vault!").addButton((button) => button.setButtonText("Force Refresh").onClick(async () => {
      if (confirm("Are you sure you want to Force Refresh? By clicking yes you confirm that you understand the consequences of this action.")) {
        await this.plugin.force_refresh_embeddings_file();
      }
    }));
  }
  get_self_ref_list() {
    return "Current: " + SMART_TRANSLATION[this.plugin.settings.language].pronous.join(", ");
  }
  draw_failed_files_list(failed_list) {
    failed_list.empty();
    if (this.plugin.settings.failed_files.length > 0) {
      failed_list.createEl("p", {
        text: "The following files failed to process and will be skipped until manually retried."
      });
      let list = failed_list.createEl("ul");
      for (let failed_file of this.plugin.settings.failed_files) {
        list.createEl("li", {
          text: failed_file
        });
      }
      new Obsidian.Setting(failed_list).setName("retry_failed_files").setDesc("Retry failed files only").addButton((button) => button.setButtonText("Retry failed files only").onClick(async () => {
        failed_list.empty();
        failed_list.createEl("p", {
          text: "Retrying failed files..."
        });
        await this.plugin.retry_failed_files();
        this.draw_failed_files_list(failed_list);
      }));
    } else {
      failed_list.createEl("p", {
        text: "No failed files"
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
        placeholder: `Try "Based on my notes" or "Summarize [[this note]]" or "Important tasks in /folder/"`
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
    button.innerHTML = "Send";
    button.addEventListener("click", () => {
      if (this.prevent_input) {
        console.log("wait until current response is finished");
        new Obsidian.Notice("Wait until current response is finished");
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
      this.request_chatgpt_completion({ messages: chatml, temperature: 0 });
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
    const matches = user_input.match(this.plugin.self_ref_kw_regex);
    if (matches)
      return true;
    return false;
  }
  // render message
  async render_message(message, from = "assistant", append_last = false) {
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
        new Obsidian.Notice("[Smart Connections] Context code block copied to clipboard");
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
        new Obsidian.Notice("[Smart Connections] Context copied to clipboard");
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
    if (opts.stream) {
      const full_str = await new Promise((resolve, reject) => {
        try {
          const url = `${this.settings.api_endpoint}/v1/chat/completions`;
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
              const payload = JSON.parse(e.data);
              const text = payload.choices[0].delta.content;
              if (!text) {
                return;
              }
              txt += text;
              this.render_message(text, "assistant", true);
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
            new Obsidian.Notice("Smart Connections Error Streaming Response. See console for details.");
            this.render_message("*API Error. See console logs for details.*", "assistant");
            this.end_stream();
            reject(e);
          });
          this.active_stream.stream();
        } catch (err) {
          console.error(err);
          new Obsidian.Notice("Smart Connections Error Streaming Response. See console for details.");
          this.end_stream();
          reject(err);
        }
      });
      await this.render_message(full_str, "assistant");
      this.chat.new_message_in_thread({
        role: "assistant",
        content: full_str
      });
      return;
    } else {
      try {
        const response = await (0, Obsidian.requestUrl)({
          url: `${this.settings.api_endpoint}/v1/chat/completions`,
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
        new Obsidian.Notice(`Smart Connections API Error :: ${err}`);
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
      new Obsidian.Notice("[Smart Connections] Failed to save chat. Invalid chat_id: '" + this.chat_id + "'");
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
    chat_view.request_chatgpt_completion({ messages: chatml, temperature: 0 });
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2luZGV4LmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJjb25zdCBPYnNpZGlhbiA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcblxuXG5jb25zdCBERUZBVUxUX1NFVFRJTkdTID0ge1xuICBhcGlfa2V5OiBcIlwiLFxuICBhcGlfZW5kcG9pbnQ6IFwiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbVwiLFxuICBjaGF0X29wZW46IHRydWUsXG4gIGZpbGVfZXhjbHVzaW9uczogXCJcIixcbiAgZm9sZGVyX2V4Y2x1c2lvbnM6IFwiXCIsXG4gIGhlYWRlcl9leGNsdXNpb25zOiBcIlwiLFxuICBwYXRoX29ubHk6IFwiXCIsXG4gIHNob3dfZnVsbF9wYXRoOiBmYWxzZSxcbiAgZXhwYW5kZWRfdmlldzogdHJ1ZSxcbiAgZ3JvdXBfbmVhcmVzdF9ieV9maWxlOiBmYWxzZSxcbiAgbGFuZ3VhZ2U6IFwiZW5cIixcbiAgbG9nX3JlbmRlcjogZmFsc2UsXG4gIGxvZ19yZW5kZXJfZmlsZXM6IGZhbHNlLFxuICByZWNlbnRseV9zZW50X3JldHJ5X25vdGljZTogZmFsc2UsXG4gIHNraXBfc2VjdGlvbnM6IGZhbHNlLFxuICBzbWFydF9jaGF0X21vZGVsOiBcImdwdC0zLjUtdHVyYm8tMTZrXCIsXG4gIHZpZXdfb3BlbjogdHJ1ZSxcbiAgdmVyc2lvbjogXCJcIixcbn07XG5jb25zdCBNQVhfRU1CRURfU1RSSU5HX0xFTkdUSCA9IDI1MDAwO1xuXG5sZXQgVkVSU0lPTjtcbmNvbnN0IFNVUFBPUlRFRF9GSUxFX1RZUEVTID0gW1wibWRcIiwgXCJjYW52YXNcIl07XG5cbi8vY3JlYXRlIG9uZSBvYmplY3Qgd2l0aCBhbGwgdGhlIHRyYW5zbGF0aW9uc1xuLy8gcmVzZWFyY2ggOiBTTUFSVF9UUkFOU0xBVElPTltsYW5ndWFnZV1ba2V5XVxuY29uc3QgU01BUlRfVFJBTlNMQVRJT04gPSB7XG4gIFwiZW5cIjoge1xuICAgIFwicHJvbm91c1wiOiBbXCJteVwiLCBcIklcIiwgXCJtZVwiLCBcIm1pbmVcIiwgXCJvdXJcIiwgXCJvdXJzXCIsIFwidXNcIiwgXCJ3ZVwiXSxcbiAgICBcInByb21wdFwiOiBcIkJhc2VkIG9uIHlvdXIgbm90ZXNcIixcbiAgICBcImluaXRpYWxfbWVzc2FnZVwiOiBcIkhpLCBJJ20gQ2hhdEdQVCB3aXRoIGFjY2VzcyB0byB5b3VyIG5vdGVzIHZpYSBTbWFydCBDb25uZWN0aW9ucy4gQXNrIG1lIGEgcXVlc3Rpb24gYWJvdXQgeW91ciBub3RlcyBhbmQgSSdsbCB0cnkgdG8gYW5zd2VyIGl0LlwiLFxuICB9LFxuICBcImVzXCI6IHtcbiAgICBcInByb25vdXNcIjogW1wibWlcIiwgXCJ5b1wiLCBcIm1cdTAwRURcIiwgXCJ0XHUwMEZBXCJdLFxuICAgIFwicHJvbXB0XCI6IFwiQmFzXHUwMEUxbmRvc2UgZW4gc3VzIG5vdGFzXCIsXG4gICAgXCJpbml0aWFsX21lc3NhZ2VcIjogXCJIb2xhLCBzb3kgQ2hhdEdQVCBjb24gYWNjZXNvIGEgdHVzIGFwdW50ZXMgYSB0cmF2XHUwMEU5cyBkZSBTbWFydCBDb25uZWN0aW9ucy4gSGF6bWUgdW5hIHByZWd1bnRhIHNvYnJlIHR1cyBhcHVudGVzIGUgaW50ZW50YXJcdTAwRTkgcmVzcG9uZGVydGUuXCIsXG4gIH0sXG4gIFwiZnJcIjoge1xuICAgIFwicHJvbm91c1wiOiBbXCJtZVwiLCBcIm1vblwiLCBcIm1hXCIsIFwibWVzXCIsIFwibW9pXCIsIFwibm91c1wiLCBcIm5vdHJlXCIsIFwibm9zXCIsIFwiamVcIiwgXCJqJ1wiLCBcIm0nXCJdLFxuICAgIFwicHJvbXB0XCI6IFwiRCdhcHJcdTAwRThzIHZvcyBub3Rlc1wiLFxuICAgIFwiaW5pdGlhbF9tZXNzYWdlXCI6IFwiQm9uam91ciwgamUgc3VpcyBDaGF0R1BUIGV0IGonYWkgYWNjXHUwMEU4cyBcdTAwRTAgdm9zIG5vdGVzIHZpYSBTbWFydCBDb25uZWN0aW9ucy4gUG9zZXotbW9pIHVuZSBxdWVzdGlvbiBzdXIgdm9zIG5vdGVzIGV0IGonZXNzYWllcmFpIGQneSByXHUwMEU5cG9uZHJlLlwiLFxuICB9LFxuICBcImRlXCI6IHtcbiAgICBcInByb25vdXNcIjogW1wibWVpblwiLCBcIm1laW5lXCIsIFwibWVpbmVuXCIsIFwibWVpbmVyXCIsIFwibWVpbmVzXCIsIFwibWlyXCIsIFwidW5zXCIsIFwidW5zZXJcIiwgXCJ1bnNlcmVuXCIsIFwidW5zZXJlclwiLCBcInVuc2VyZXNcIl0sXG4gICAgXCJwcm9tcHRcIjogXCJCYXNpZXJlbmQgYXVmIElocmVuIE5vdGl6ZW5cIixcbiAgICBcImluaXRpYWxfbWVzc2FnZVwiOiBcIkhhbGxvLCBpY2ggYmluIENoYXRHUFQgdW5kIGhhYmUgXHUwMEZDYmVyIFNtYXJ0IENvbm5lY3Rpb25zIFp1Z2FuZyB6dSBJaHJlbiBOb3RpemVuLiBTdGVsbGVuIFNpZSBtaXIgZWluZSBGcmFnZSB6dSBJaHJlbiBOb3RpemVuIHVuZCBpY2ggd2VyZGUgdmVyc3VjaGVuLCBzaWUgenUgYmVhbnR3b3J0ZW4uXCIsXG4gIH0sXG4gIFwiaXRcIjoge1xuICAgIFwicHJvbm91c1wiOiBbXCJtaW9cIiwgXCJtaWFcIiwgXCJtaWVpXCIsIFwibWllXCIsIFwibm9pXCIsIFwibm9zdHJvXCIsIFwibm9zdHJpXCIsIFwibm9zdHJhXCIsIFwibm9zdHJlXCJdLFxuICAgIFwicHJvbXB0XCI6IFwiU3VsbGEgYmFzZSBkZWdsaSBhcHB1bnRpXCIsXG4gICAgXCJpbml0aWFsX21lc3NhZ2VcIjogXCJDaWFvLCBzb25vIENoYXRHUFQgZSBobyBhY2Nlc3NvIGFpIHR1b2kgYXBwdW50aSB0cmFtaXRlIFNtYXJ0IENvbm5lY3Rpb25zLiBGYXRlbWkgdW5hIGRvbWFuZGEgc3VpIHZvc3RyaSBhcHB1bnRpIGUgY2VyY2hlclx1MDBGMiBkaSByaXNwb25kZXJ2aS5cIixcbiAgfSxcbn1cblxuY2xhc3MgVmVjTGl0ZSB7XG4gIGNvbnN0cnVjdG9yKGNvbmZpZykge1xuICAgIHRoaXMuY29uZmlnID0ge1xuICAgICAgZmlsZV9uYW1lOiBcImVtYmVkZGluZ3MtMy5qc29uXCIsXG4gICAgICBmb2xkZXJfcGF0aDogXCIudmVjX2xpdGVcIixcbiAgICAgIGV4aXN0c19hZGFwdGVyOiBudWxsLFxuICAgICAgbWtkaXJfYWRhcHRlcjogbnVsbCxcbiAgICAgIHJlYWRfYWRhcHRlcjogbnVsbCxcbiAgICAgIHJlbmFtZV9hZGFwdGVyOiBudWxsLFxuICAgICAgc3RhdF9hZGFwdGVyOiBudWxsLFxuICAgICAgd3JpdGVfYWRhcHRlcjogbnVsbCxcbiAgICAgIC4uLmNvbmZpZ1xuICAgIH07XG4gICAgdGhpcy5maWxlX25hbWUgPSB0aGlzLmNvbmZpZy5maWxlX25hbWU7XG4gICAgdGhpcy5mb2xkZXJfcGF0aCA9IGNvbmZpZy5mb2xkZXJfcGF0aDtcbiAgICB0aGlzLmZpbGVfcGF0aCA9IHRoaXMuZm9sZGVyX3BhdGggKyBcIi9cIiArIHRoaXMuZmlsZV9uYW1lO1xuICAgIHRoaXMuZW1iZWRkaW5ncyA9IGZhbHNlO1xuICB9XG4gIGFzeW5jIGZpbGVfZXhpc3RzKHBhdGgpIHtcbiAgICBpZiAodGhpcy5jb25maWcuZXhpc3RzX2FkYXB0ZXIpIHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbmZpZy5leGlzdHNfYWRhcHRlcihwYXRoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiZXhpc3RzX2FkYXB0ZXIgbm90IHNldFwiKTtcbiAgICB9XG4gIH1cbiAgYXN5bmMgbWtkaXIocGF0aCkge1xuICAgIGlmICh0aGlzLmNvbmZpZy5ta2Rpcl9hZGFwdGVyKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5jb25maWcubWtkaXJfYWRhcHRlcihwYXRoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwibWtkaXJfYWRhcHRlciBub3Qgc2V0XCIpO1xuICAgIH1cbiAgfVxuICBhc3luYyByZWFkX2ZpbGUocGF0aCkge1xuICAgIGlmICh0aGlzLmNvbmZpZy5yZWFkX2FkYXB0ZXIpIHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbmZpZy5yZWFkX2FkYXB0ZXIocGF0aCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInJlYWRfYWRhcHRlciBub3Qgc2V0XCIpO1xuICAgIH1cbiAgfVxuICBhc3luYyByZW5hbWUob2xkX3BhdGgsIG5ld19wYXRoKSB7XG4gICAgaWYgKHRoaXMuY29uZmlnLnJlbmFtZV9hZGFwdGVyKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5jb25maWcucmVuYW1lX2FkYXB0ZXIob2xkX3BhdGgsIG5ld19wYXRoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwicmVuYW1lX2FkYXB0ZXIgbm90IHNldFwiKTtcbiAgICB9XG4gIH1cbiAgYXN5bmMgc3RhdChwYXRoKSB7XG4gICAgaWYgKHRoaXMuY29uZmlnLnN0YXRfYWRhcHRlcikge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuY29uZmlnLnN0YXRfYWRhcHRlcihwYXRoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic3RhdF9hZGFwdGVyIG5vdCBzZXRcIik7XG4gICAgfVxuICB9XG4gIGFzeW5jIHdyaXRlX2ZpbGUocGF0aCwgZGF0YSkge1xuICAgIGlmICh0aGlzLmNvbmZpZy53cml0ZV9hZGFwdGVyKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5jb25maWcud3JpdGVfYWRhcHRlcihwYXRoLCBkYXRhKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwid3JpdGVfYWRhcHRlciBub3Qgc2V0XCIpO1xuICAgIH1cbiAgfVxuICBhc3luYyBsb2FkKHJldHJpZXMgPSAwKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGVtYmVkZGluZ3NfZmlsZSA9IGF3YWl0IHRoaXMucmVhZF9maWxlKHRoaXMuZmlsZV9wYXRoKTtcbiAgICAgIHRoaXMuZW1iZWRkaW5ncyA9IEpTT04ucGFyc2UoZW1iZWRkaW5nc19maWxlKTtcbiAgICAgIGNvbnNvbGUubG9nKFwibG9hZGVkIGVtYmVkZGluZ3MgZmlsZTogXCIgKyB0aGlzLmZpbGVfcGF0aCk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKHJldHJpZXMgPCAzKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKFwicmV0cnlpbmcgbG9hZCgpXCIpO1xuICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocikgPT4gc2V0VGltZW91dChyLCAxZTMgKyAxZTMgKiByZXRyaWVzKSk7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmxvYWQocmV0cmllcyArIDEpO1xuICAgICAgfSBlbHNlIGlmIChyZXRyaWVzID09PSAzKSB7XG4gICAgICAgIGNvbnN0IGVtYmVkZGluZ3NfMl9maWxlX3BhdGggPSB0aGlzLmZvbGRlcl9wYXRoICsgXCIvZW1iZWRkaW5ncy0yLmpzb25cIjtcbiAgICAgICAgY29uc3QgZW1iZWRkaW5nc18yX2ZpbGVfZXhpc3RzID0gYXdhaXQgdGhpcy5maWxlX2V4aXN0cyhlbWJlZGRpbmdzXzJfZmlsZV9wYXRoKTtcbiAgICAgICAgaWYgKGVtYmVkZGluZ3NfMl9maWxlX2V4aXN0cykge1xuICAgICAgICAgIGF3YWl0IHRoaXMubWlncmF0ZV9lbWJlZGRpbmdzX3YyX3RvX3YzKCk7XG4gICAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMubG9hZChyZXRyaWVzICsgMSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGNvbnNvbGUubG9nKFwiZmFpbGVkIHRvIGxvYWQgZW1iZWRkaW5ncyBmaWxlLCBwcm9tcHQgdXNlciB0byBpbml0aWF0ZSBidWxrIGVtYmVkXCIpO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuICBhc3luYyBtaWdyYXRlX2VtYmVkZGluZ3NfdjJfdG9fdjMoKSB7XG4gICAgY29uc29sZS5sb2coXCJtaWdyYXRpbmcgZW1iZWRkaW5ncy0yLmpzb24gdG8gZW1iZWRkaW5ncy0zLmpzb25cIik7XG4gICAgY29uc3QgZW1iZWRkaW5nc18yX2ZpbGVfcGF0aCA9IHRoaXMuZm9sZGVyX3BhdGggKyBcIi9lbWJlZGRpbmdzLTIuanNvblwiO1xuICAgIGNvbnN0IGVtYmVkZGluZ3NfMl9maWxlID0gYXdhaXQgdGhpcy5yZWFkX2ZpbGUoZW1iZWRkaW5nc18yX2ZpbGVfcGF0aCk7XG4gICAgY29uc3QgZW1iZWRkaW5nc18yID0gSlNPTi5wYXJzZShlbWJlZGRpbmdzXzJfZmlsZSk7XG4gICAgY29uc3QgZW1iZWRkaW5nc18zID0ge307XG4gICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoZW1iZWRkaW5nc18yKSkge1xuICAgICAgY29uc3QgbmV3X29iaiA9IHtcbiAgICAgICAgdmVjOiB2YWx1ZS52ZWMsXG4gICAgICAgIG1ldGE6IHt9XG4gICAgICB9O1xuICAgICAgY29uc3QgbWV0YSA9IHZhbHVlLm1ldGE7XG4gICAgICBjb25zdCBuZXdfbWV0YSA9IHt9O1xuICAgICAgaWYgKG1ldGEuaGFzaClcbiAgICAgICAgbmV3X21ldGEuaGFzaCA9IG1ldGEuaGFzaDtcbiAgICAgIGlmIChtZXRhLmZpbGUpXG4gICAgICAgIG5ld19tZXRhLnBhcmVudCA9IG1ldGEuZmlsZTtcbiAgICAgIGlmIChtZXRhLmJsb2NrcylcbiAgICAgICAgbmV3X21ldGEuY2hpbGRyZW4gPSBtZXRhLmJsb2NrcztcbiAgICAgIGlmIChtZXRhLm10aW1lKVxuICAgICAgICBuZXdfbWV0YS5tdGltZSA9IG1ldGEubXRpbWU7XG4gICAgICBpZiAobWV0YS5zaXplKVxuICAgICAgICBuZXdfbWV0YS5zaXplID0gbWV0YS5zaXplO1xuICAgICAgaWYgKG1ldGEubGVuKVxuICAgICAgICBuZXdfbWV0YS5zaXplID0gbWV0YS5sZW47XG4gICAgICBpZiAobWV0YS5wYXRoKVxuICAgICAgICBuZXdfbWV0YS5wYXRoID0gbWV0YS5wYXRoO1xuICAgICAgbmV3X21ldGEuc3JjID0gXCJmaWxlXCI7XG4gICAgICBuZXdfb2JqLm1ldGEgPSBuZXdfbWV0YTtcbiAgICAgIGVtYmVkZGluZ3NfM1trZXldID0gbmV3X29iajtcbiAgICB9XG4gICAgY29uc3QgZW1iZWRkaW5nc18zX2ZpbGUgPSBKU09OLnN0cmluZ2lmeShlbWJlZGRpbmdzXzMpO1xuICAgIGF3YWl0IHRoaXMud3JpdGVfZmlsZSh0aGlzLmZpbGVfcGF0aCwgZW1iZWRkaW5nc18zX2ZpbGUpO1xuICB9XG4gIGFzeW5jIGluaXRfZW1iZWRkaW5nc19maWxlKCkge1xuICAgIGlmICghYXdhaXQgdGhpcy5maWxlX2V4aXN0cyh0aGlzLmZvbGRlcl9wYXRoKSkge1xuICAgICAgYXdhaXQgdGhpcy5ta2Rpcih0aGlzLmZvbGRlcl9wYXRoKTtcbiAgICAgIGNvbnNvbGUubG9nKFwiY3JlYXRlZCBmb2xkZXI6IFwiICsgdGhpcy5mb2xkZXJfcGF0aCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnNvbGUubG9nKFwiZm9sZGVyIGFscmVhZHkgZXhpc3RzOiBcIiArIHRoaXMuZm9sZGVyX3BhdGgpO1xuICAgIH1cbiAgICBpZiAoIWF3YWl0IHRoaXMuZmlsZV9leGlzdHModGhpcy5maWxlX3BhdGgpKSB7XG4gICAgICBhd2FpdCB0aGlzLndyaXRlX2ZpbGUodGhpcy5maWxlX3BhdGgsIFwie31cIik7XG4gICAgICBjb25zb2xlLmxvZyhcImNyZWF0ZWQgZW1iZWRkaW5ncyBmaWxlOiBcIiArIHRoaXMuZmlsZV9wYXRoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc29sZS5sb2coXCJlbWJlZGRpbmdzIGZpbGUgYWxyZWFkeSBleGlzdHM6IFwiICsgdGhpcy5maWxlX3BhdGgpO1xuICAgIH1cbiAgfVxuICBhc3luYyBzYXZlKCkge1xuICAgIGNvbnN0IGVtYmVkZGluZ3MgPSBKU09OLnN0cmluZ2lmeSh0aGlzLmVtYmVkZGluZ3MpO1xuICAgIGNvbnN0IGVtYmVkZGluZ3NfZmlsZV9leGlzdHMgPSBhd2FpdCB0aGlzLmZpbGVfZXhpc3RzKHRoaXMuZmlsZV9wYXRoKTtcbiAgICBpZiAoZW1iZWRkaW5nc19maWxlX2V4aXN0cykge1xuICAgICAgY29uc3QgbmV3X2ZpbGVfc2l6ZSA9IGVtYmVkZGluZ3MubGVuZ3RoO1xuICAgICAgY29uc3QgZXhpc3RpbmdfZmlsZV9zaXplID0gYXdhaXQgdGhpcy5zdGF0KHRoaXMuZmlsZV9wYXRoKS50aGVuKChzdGF0KSA9PiBzdGF0LnNpemUpO1xuICAgICAgaWYgKG5ld19maWxlX3NpemUgPiBleGlzdGluZ19maWxlX3NpemUgKiAwLjUpIHtcbiAgICAgICAgYXdhaXQgdGhpcy53cml0ZV9maWxlKHRoaXMuZmlsZV9wYXRoLCBlbWJlZGRpbmdzKTtcbiAgICAgICAgY29uc29sZS5sb2coXCJlbWJlZGRpbmdzIGZpbGUgc2l6ZTogXCIgKyBuZXdfZmlsZV9zaXplICsgXCIgYnl0ZXNcIik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCB3YXJuaW5nX21lc3NhZ2UgPSBbXG4gICAgICAgICAgXCJXYXJuaW5nOiBOZXcgZW1iZWRkaW5ncyBmaWxlIHNpemUgaXMgc2lnbmlmaWNhbnRseSBzbWFsbGVyIHRoYW4gZXhpc3RpbmcgZW1iZWRkaW5ncyBmaWxlIHNpemUuXCIsXG4gICAgICAgICAgXCJBYm9ydGluZyB0byBwcmV2ZW50IHBvc3NpYmxlIGxvc3Mgb2YgZW1iZWRkaW5ncyBkYXRhLlwiLFxuICAgICAgICAgIFwiTmV3IGZpbGUgc2l6ZTogXCIgKyBuZXdfZmlsZV9zaXplICsgXCIgYnl0ZXMuXCIsXG4gICAgICAgICAgXCJFeGlzdGluZyBmaWxlIHNpemU6IFwiICsgZXhpc3RpbmdfZmlsZV9zaXplICsgXCIgYnl0ZXMuXCIsXG4gICAgICAgICAgXCJSZXN0YXJ0aW5nIE9ic2lkaWFuIG1heSBmaXggdGhpcy5cIlxuICAgICAgICBdO1xuICAgICAgICBjb25zb2xlLmxvZyh3YXJuaW5nX21lc3NhZ2Uuam9pbihcIiBcIikpO1xuICAgICAgICBhd2FpdCB0aGlzLndyaXRlX2ZpbGUodGhpcy5mb2xkZXJfcGF0aCArIFwiL3Vuc2F2ZWQtZW1iZWRkaW5ncy5qc29uXCIsIGVtYmVkZGluZ3MpO1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJFcnJvcjogTmV3IGVtYmVkZGluZ3MgZmlsZSBzaXplIGlzIHNpZ25pZmljYW50bHkgc21hbGxlciB0aGFuIGV4aXN0aW5nIGVtYmVkZGluZ3MgZmlsZSBzaXplLiBBYm9ydGluZyB0byBwcmV2ZW50IHBvc3NpYmxlIGxvc3Mgb2YgZW1iZWRkaW5ncyBkYXRhLlwiKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgdGhpcy5pbml0X2VtYmVkZGluZ3NfZmlsZSgpO1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuc2F2ZSgpO1xuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuICBjb3Nfc2ltKHZlY3RvcjEsIHZlY3RvcjIpIHtcbiAgICBsZXQgZG90UHJvZHVjdCA9IDA7XG4gICAgbGV0IG5vcm1BID0gMDtcbiAgICBsZXQgbm9ybUIgPSAwO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdmVjdG9yMS5sZW5ndGg7IGkrKykge1xuICAgICAgZG90UHJvZHVjdCArPSB2ZWN0b3IxW2ldICogdmVjdG9yMltpXTtcbiAgICAgIG5vcm1BICs9IHZlY3RvcjFbaV0gKiB2ZWN0b3IxW2ldO1xuICAgICAgbm9ybUIgKz0gdmVjdG9yMltpXSAqIHZlY3RvcjJbaV07XG4gICAgfVxuICAgIGlmIChub3JtQSA9PT0gMCB8fCBub3JtQiA9PT0gMCkge1xuICAgICAgcmV0dXJuIDA7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBkb3RQcm9kdWN0IC8gKE1hdGguc3FydChub3JtQSkgKiBNYXRoLnNxcnQobm9ybUIpKTtcbiAgICB9XG4gIH1cbiAgbmVhcmVzdCh0b192ZWMsIGZpbHRlciA9IHt9KSB7XG4gICAgZmlsdGVyID0ge1xuICAgICAgcmVzdWx0c19jb3VudDogMzAsXG4gICAgICAuLi5maWx0ZXJcbiAgICB9O1xuICAgIGxldCBuZWFyZXN0ID0gW107XG4gICAgY29uc3QgZnJvbV9rZXlzID0gT2JqZWN0LmtleXModGhpcy5lbWJlZGRpbmdzKTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGZyb21fa2V5cy5sZW5ndGg7IGkrKykge1xuICAgICAgaWYgKGZpbHRlci5za2lwX3NlY3Rpb25zKSB7XG4gICAgICAgIGNvbnN0IGZyb21fcGF0aCA9IHRoaXMuZW1iZWRkaW5nc1tmcm9tX2tleXNbaV1dLm1ldGEucGF0aDtcbiAgICAgICAgaWYgKGZyb21fcGF0aC5pbmRleE9mKFwiI1wiKSA+IC0xKVxuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGZpbHRlci5za2lwX2tleSkge1xuICAgICAgICBpZiAoZmlsdGVyLnNraXBfa2V5ID09PSBmcm9tX2tleXNbaV0pXG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIGlmIChmaWx0ZXIuc2tpcF9rZXkgPT09IHRoaXMuZW1iZWRkaW5nc1tmcm9tX2tleXNbaV1dLm1ldGEucGFyZW50KVxuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGZpbHRlci5wYXRoX2JlZ2luc193aXRoKSB7XG4gICAgICAgIGlmICh0eXBlb2YgZmlsdGVyLnBhdGhfYmVnaW5zX3dpdGggPT09IFwic3RyaW5nXCIgJiYgIXRoaXMuZW1iZWRkaW5nc1tmcm9tX2tleXNbaV1dLm1ldGEucGF0aC5zdGFydHNXaXRoKGZpbHRlci5wYXRoX2JlZ2luc193aXRoKSlcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoZmlsdGVyLnBhdGhfYmVnaW5zX3dpdGgpICYmICFmaWx0ZXIucGF0aF9iZWdpbnNfd2l0aC5zb21lKChwYXRoKSA9PiB0aGlzLmVtYmVkZGluZ3NbZnJvbV9rZXlzW2ldXS5tZXRhLnBhdGguc3RhcnRzV2l0aChwYXRoKSkpXG4gICAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBuZWFyZXN0LnB1c2goe1xuICAgICAgICBsaW5rOiB0aGlzLmVtYmVkZGluZ3NbZnJvbV9rZXlzW2ldXS5tZXRhLnBhdGgsXG4gICAgICAgIHNpbWlsYXJpdHk6IHRoaXMuY29zX3NpbSh0b192ZWMsIHRoaXMuZW1iZWRkaW5nc1tmcm9tX2tleXNbaV1dLnZlYyksXG4gICAgICAgIHNpemU6IHRoaXMuZW1iZWRkaW5nc1tmcm9tX2tleXNbaV1dLm1ldGEuc2l6ZVxuICAgICAgfSk7XG4gICAgfVxuICAgIG5lYXJlc3Quc29ydChmdW5jdGlvbiAoYSwgYikge1xuICAgICAgcmV0dXJuIGIuc2ltaWxhcml0eSAtIGEuc2ltaWxhcml0eTtcbiAgICB9KTtcbiAgICBuZWFyZXN0ID0gbmVhcmVzdC5zbGljZSgwLCBmaWx0ZXIucmVzdWx0c19jb3VudCk7XG4gICAgcmV0dXJuIG5lYXJlc3Q7XG4gIH1cbiAgZmluZF9uZWFyZXN0X2VtYmVkZGluZ3ModG9fdmVjLCBmaWx0ZXIgPSB7fSkge1xuICAgIGNvbnN0IGRlZmF1bHRfZmlsdGVyID0ge1xuICAgICAgbWF4OiB0aGlzLm1heF9zb3VyY2VzXG4gICAgfTtcbiAgICBmaWx0ZXIgPSB7IC4uLmRlZmF1bHRfZmlsdGVyLCAuLi5maWx0ZXIgfTtcbiAgICBpZiAoQXJyYXkuaXNBcnJheSh0b192ZWMpICYmIHRvX3ZlYy5sZW5ndGggIT09IHRoaXMudmVjX2xlbikge1xuICAgICAgdGhpcy5uZWFyZXN0ID0ge307XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRvX3ZlYy5sZW5ndGg7IGkrKykge1xuICAgICAgICB0aGlzLmZpbmRfbmVhcmVzdF9lbWJlZGRpbmdzKHRvX3ZlY1tpXSwge1xuICAgICAgICAgIG1heDogTWF0aC5mbG9vcihmaWx0ZXIubWF4IC8gdG9fdmVjLmxlbmd0aClcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IGZyb21fa2V5cyA9IE9iamVjdC5rZXlzKHRoaXMuZW1iZWRkaW5ncyk7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGZyb21fa2V5cy5sZW5ndGg7IGkrKykge1xuICAgICAgICBpZiAodGhpcy52YWxpZGF0ZV90eXBlKHRoaXMuZW1iZWRkaW5nc1tmcm9tX2tleXNbaV1dKSlcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgY29uc3Qgc2ltID0gdGhpcy5jb21wdXRlQ29zaW5lU2ltaWxhcml0eSh0b192ZWMsIHRoaXMuZW1iZWRkaW5nc1tmcm9tX2tleXNbaV1dLnZlYyk7XG4gICAgICAgIGlmICh0aGlzLm5lYXJlc3RbZnJvbV9rZXlzW2ldXSkge1xuICAgICAgICAgIHRoaXMubmVhcmVzdFtmcm9tX2tleXNbaV1dICs9IHNpbTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLm5lYXJlc3RbZnJvbV9rZXlzW2ldXSA9IHNpbTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBsZXQgbmVhcmVzdCA9IE9iamVjdC5rZXlzKHRoaXMubmVhcmVzdCkubWFwKChrZXkpID0+IHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGtleSxcbiAgICAgICAgc2ltaWxhcml0eTogdGhpcy5uZWFyZXN0W2tleV1cbiAgICAgIH07XG4gICAgfSk7XG4gICAgbmVhcmVzdCA9IHRoaXMuc29ydF9ieV9zaW1pbGFyaXR5KG5lYXJlc3QpO1xuICAgIG5lYXJlc3QgPSBuZWFyZXN0LnNsaWNlKDAsIGZpbHRlci5tYXgpO1xuICAgIG5lYXJlc3QgPSBuZWFyZXN0Lm1hcCgoaXRlbSkgPT4ge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgbGluazogdGhpcy5lbWJlZGRpbmdzW2l0ZW0ua2V5XS5tZXRhLnBhdGgsXG4gICAgICAgIHNpbWlsYXJpdHk6IGl0ZW0uc2ltaWxhcml0eSxcbiAgICAgICAgbGVuOiB0aGlzLmVtYmVkZGluZ3NbaXRlbS5rZXldLm1ldGEubGVuIHx8IHRoaXMuZW1iZWRkaW5nc1tpdGVtLmtleV0ubWV0YS5zaXplXG4gICAgICB9O1xuICAgIH0pO1xuICAgIHJldHVybiBuZWFyZXN0O1xuICB9XG4gIHNvcnRfYnlfc2ltaWxhcml0eShuZWFyZXN0KSB7XG4gICAgcmV0dXJuIG5lYXJlc3Quc29ydChmdW5jdGlvbiAoYSwgYikge1xuICAgICAgY29uc3QgYV9zY29yZSA9IGEuc2ltaWxhcml0eTtcbiAgICAgIGNvbnN0IGJfc2NvcmUgPSBiLnNpbWlsYXJpdHk7XG4gICAgICBpZiAoYV9zY29yZSA+IGJfc2NvcmUpXG4gICAgICAgIHJldHVybiAtMTtcbiAgICAgIGlmIChhX3Njb3JlIDwgYl9zY29yZSlcbiAgICAgICAgcmV0dXJuIDE7XG4gICAgICByZXR1cm4gMDtcbiAgICB9KTtcbiAgfVxuICAvLyBjaGVjayBpZiBrZXkgZnJvbSBlbWJlZGRpbmdzIGV4aXN0cyBpbiBmaWxlc1xuICBjbGVhbl91cF9lbWJlZGRpbmdzKGZpbGVzKSB7XG4gICAgY29uc29sZS5sb2coXCJjbGVhbmluZyB1cCBlbWJlZGRpbmdzXCIpO1xuICAgIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyh0aGlzLmVtYmVkZGluZ3MpO1xuICAgIGxldCBkZWxldGVkX2VtYmVkZGluZ3MgPSAwO1xuICAgIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIHtcbiAgICAgIGNvbnN0IHBhdGggPSB0aGlzLmVtYmVkZGluZ3Nba2V5XS5tZXRhLnBhdGg7XG4gICAgICBpZiAoIWZpbGVzLmZpbmQoKGZpbGUpID0+IHBhdGguc3RhcnRzV2l0aChmaWxlLnBhdGgpKSkge1xuICAgICAgICBkZWxldGUgdGhpcy5lbWJlZGRpbmdzW2tleV07XG4gICAgICAgIGRlbGV0ZWRfZW1iZWRkaW5ncysrO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChwYXRoLmluZGV4T2YoXCIjXCIpID4gLTEpIHtcbiAgICAgICAgY29uc3QgcGFyZW50X2tleSA9IHRoaXMuZW1iZWRkaW5nc1trZXldLm1ldGEucGFyZW50O1xuICAgICAgICBpZiAoIXRoaXMuZW1iZWRkaW5nc1twYXJlbnRfa2V5XSkge1xuICAgICAgICAgIGRlbGV0ZSB0aGlzLmVtYmVkZGluZ3Nba2V5XTtcbiAgICAgICAgICBkZWxldGVkX2VtYmVkZGluZ3MrKztcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXRoaXMuZW1iZWRkaW5nc1twYXJlbnRfa2V5XS5tZXRhKSB7XG4gICAgICAgICAgZGVsZXRlIHRoaXMuZW1iZWRkaW5nc1trZXldO1xuICAgICAgICAgIGRlbGV0ZWRfZW1iZWRkaW5ncysrO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLmVtYmVkZGluZ3NbcGFyZW50X2tleV0ubWV0YS5jaGlsZHJlbiAmJiB0aGlzLmVtYmVkZGluZ3NbcGFyZW50X2tleV0ubWV0YS5jaGlsZHJlbi5pbmRleE9mKGtleSkgPCAwKSB7XG4gICAgICAgICAgZGVsZXRlIHRoaXMuZW1iZWRkaW5nc1trZXldO1xuICAgICAgICAgIGRlbGV0ZWRfZW1iZWRkaW5ncysrO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB7IGRlbGV0ZWRfZW1iZWRkaW5ncywgdG90YWxfZW1iZWRkaW5nczoga2V5cy5sZW5ndGggfTtcbiAgfVxuICBnZXQoa2V5KSB7XG4gICAgcmV0dXJuIHRoaXMuZW1iZWRkaW5nc1trZXldIHx8IG51bGw7XG4gIH1cbiAgZ2V0X21ldGEoa2V5KSB7XG4gICAgY29uc3QgZW1iZWRkaW5nID0gdGhpcy5nZXQoa2V5KTtcbiAgICBpZiAoZW1iZWRkaW5nICYmIGVtYmVkZGluZy5tZXRhKSB7XG4gICAgICByZXR1cm4gZW1iZWRkaW5nLm1ldGE7XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xuICB9XG4gIGdldF9tdGltZShrZXkpIHtcbiAgICBjb25zdCBtZXRhID0gdGhpcy5nZXRfbWV0YShrZXkpO1xuICAgIGlmIChtZXRhICYmIG1ldGEubXRpbWUpIHtcbiAgICAgIHJldHVybiBtZXRhLm10aW1lO1xuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICBnZXRfaGFzaChrZXkpIHtcbiAgICBjb25zdCBtZXRhID0gdGhpcy5nZXRfbWV0YShrZXkpO1xuICAgIGlmIChtZXRhICYmIG1ldGEuaGFzaCkge1xuICAgICAgcmV0dXJuIG1ldGEuaGFzaDtcbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgZ2V0X3NpemUoa2V5KSB7XG4gICAgY29uc3QgbWV0YSA9IHRoaXMuZ2V0X21ldGEoa2V5KTtcbiAgICBpZiAobWV0YSAmJiBtZXRhLnNpemUpIHtcbiAgICAgIHJldHVybiBtZXRhLnNpemU7XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xuICB9XG4gIGdldF9jaGlsZHJlbihrZXkpIHtcbiAgICBjb25zdCBtZXRhID0gdGhpcy5nZXRfbWV0YShrZXkpO1xuICAgIGlmIChtZXRhICYmIG1ldGEuY2hpbGRyZW4pIHtcbiAgICAgIHJldHVybiBtZXRhLmNoaWxkcmVuO1xuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICBnZXRfdmVjKGtleSkge1xuICAgIGNvbnN0IGVtYmVkZGluZyA9IHRoaXMuZ2V0KGtleSk7XG4gICAgaWYgKGVtYmVkZGluZyAmJiBlbWJlZGRpbmcudmVjKSB7XG4gICAgICByZXR1cm4gZW1iZWRkaW5nLnZlYztcbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgc2F2ZV9lbWJlZGRpbmcoa2V5LCB2ZWMsIG1ldGEpIHtcbiAgICB0aGlzLmVtYmVkZGluZ3Nba2V5XSA9IHtcbiAgICAgIHZlYyxcbiAgICAgIG1ldGFcbiAgICB9O1xuICB9XG4gIG10aW1lX2lzX2N1cnJlbnQoa2V5LCBzb3VyY2VfbXRpbWUpIHtcbiAgICBjb25zdCBtdGltZSA9IHRoaXMuZ2V0X210aW1lKGtleSk7XG4gICAgaWYgKG10aW1lICYmIG10aW1lID49IHNvdXJjZV9tdGltZSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBhc3luYyBmb3JjZV9yZWZyZXNoKCkge1xuICAgIHRoaXMuZW1iZWRkaW5ncyA9IG51bGw7XG4gICAgdGhpcy5lbWJlZGRpbmdzID0ge307XG4gICAgbGV0IGN1cnJlbnRfZGF0ZXRpbWUgPSBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxZTMpO1xuICAgIGF3YWl0IHRoaXMucmVuYW1lKHRoaXMuZmlsZV9wYXRoLCB0aGlzLmZvbGRlcl9wYXRoICsgXCIvZW1iZWRkaW5ncy1cIiArIGN1cnJlbnRfZGF0ZXRpbWUgKyBcIi5qc29uXCIpO1xuICAgIGF3YWl0IHRoaXMuaW5pdF9lbWJlZGRpbmdzX2ZpbGUoKTtcbiAgfVxufTtcblxuXG4vLyByZXF1aXJlIGJ1aWx0LWluIGNyeXB0byBtb2R1bGVcbmNvbnN0IGNyeXB0byA9IHJlcXVpcmUoXCJjcnlwdG9cIik7XG4vLyBtZDUgaGFzaCB1c2luZyBidWlsdCBpbiBjcnlwdG8gbW9kdWxlXG5mdW5jdGlvbiBtZDUoc3RyKSB7XG4gIHJldHVybiBjcnlwdG8uY3JlYXRlSGFzaChcIm1kNVwiKS51cGRhdGUoc3RyKS5kaWdlc3QoXCJoZXhcIik7XG59XG5cbmNsYXNzIFNtYXJ0Q29ubmVjdGlvbnNQbHVnaW4gZXh0ZW5kcyBPYnNpZGlhbi5QbHVnaW4ge1xuICAvLyBjb25zdHJ1Y3RvclxuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBzdXBlciguLi5hcmd1bWVudHMpO1xuICAgIHRoaXMuYXBpID0gbnVsbDtcbiAgICB0aGlzLmVtYmVkZGluZ3NfbG9hZGVkID0gZmFsc2U7XG4gICAgdGhpcy5maWxlX2V4Y2x1c2lvbnMgPSBbXTtcbiAgICB0aGlzLmZvbGRlcnMgPSBbXTtcbiAgICB0aGlzLmhhc19uZXdfZW1iZWRkaW5ncyA9IGZhbHNlO1xuICAgIHRoaXMuaGVhZGVyX2V4Y2x1c2lvbnMgPSBbXTtcbiAgICB0aGlzLm5lYXJlc3RfY2FjaGUgPSB7fTtcbiAgICB0aGlzLnBhdGhfb25seSA9IFtdO1xuICAgIHRoaXMucmVuZGVyX2xvZyA9IHt9O1xuICAgIHRoaXMucmVuZGVyX2xvZy5kZWxldGVkX2VtYmVkZGluZ3MgPSAwO1xuICAgIHRoaXMucmVuZGVyX2xvZy5leGNsdXNpb25zX2xvZ3MgPSB7fTtcbiAgICB0aGlzLnJlbmRlcl9sb2cuZmFpbGVkX2VtYmVkZGluZ3MgPSBbXTtcbiAgICB0aGlzLnJlbmRlcl9sb2cuZmlsZXMgPSBbXTtcbiAgICB0aGlzLnJlbmRlcl9sb2cubmV3X2VtYmVkZGluZ3MgPSAwO1xuICAgIHRoaXMucmVuZGVyX2xvZy5za2lwcGVkX2xvd19kZWx0YSA9IHt9O1xuICAgIHRoaXMucmVuZGVyX2xvZy50b2tlbl91c2FnZSA9IDA7XG4gICAgdGhpcy5yZW5kZXJfbG9nLnRva2Vuc19zYXZlZF9ieV9jYWNoZSA9IDA7XG4gICAgdGhpcy5yZXRyeV9ub3RpY2VfdGltZW91dCA9IG51bGw7XG4gICAgdGhpcy5zYXZlX3RpbWVvdXQgPSBudWxsO1xuICAgIHRoaXMuc2NfYnJhbmRpbmcgPSB7fTtcbiAgICB0aGlzLnNlbGZfcmVmX2t3X3JlZ2V4ID0gbnVsbDtcbiAgICB0aGlzLnVwZGF0ZV9hdmFpbGFibGUgPSBmYWxzZTtcbiAgfVxuXG4gIGFzeW5jIG9ubG9hZCgpIHtcbiAgICAvLyBpbml0aWFsaXplIHdoZW4gbGF5b3V0IGlzIHJlYWR5XG4gICAgdGhpcy5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkodGhpcy5pbml0aWFsaXplLmJpbmQodGhpcykpO1xuICB9XG4gIG9udW5sb2FkKCkge1xuICAgIHRoaXMub3V0cHV0X3JlbmRlcl9sb2coKTtcbiAgICBjb25zb2xlLmxvZyhcInVubG9hZGluZyBwbHVnaW5cIik7XG4gICAgdGhpcy5hcHAud29ya3NwYWNlLmRldGFjaExlYXZlc09mVHlwZShTTUFSVF9DT05ORUNUSU9OU19WSUVXX1RZUEUpO1xuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5kZXRhY2hMZWF2ZXNPZlR5cGUoU01BUlRfQ09OTkVDVElPTlNfQ0hBVF9WSUVXX1RZUEUpO1xuICB9XG4gIGFzeW5jIGluaXRpYWxpemUoKSB7XG4gICAgY29uc29sZS5sb2coXCJMb2FkaW5nIFNtYXJ0IENvbm5lY3Rpb25zIHBsdWdpblwiKTtcbiAgICBWRVJTSU9OID0gdGhpcy5tYW5pZmVzdC52ZXJzaW9uO1xuICAgIC8vIFZFUlNJT04gPSAnMS4wLjAnO1xuICAgIC8vIGNvbnNvbGUubG9nKFZFUlNJT04pO1xuICAgIGF3YWl0IHRoaXMubG9hZFNldHRpbmdzKCk7XG4gICAgLy8gcnVuIGFmdGVyIDMgc2Vjb25kc1xuICAgIHNldFRpbWVvdXQodGhpcy5jaGVja19mb3JfdXBkYXRlLmJpbmQodGhpcyksIDMwMDApO1xuICAgIC8vIHJ1biBjaGVjayBmb3IgdXBkYXRlIGV2ZXJ5IDMgaG91cnNcbiAgICBzZXRJbnRlcnZhbCh0aGlzLmNoZWNrX2Zvcl91cGRhdGUuYmluZCh0aGlzKSwgMTA4MDAwMDApO1xuXG4gICAgdGhpcy5hZGRJY29uKCk7XG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcInNjLWZpbmQtbm90ZXNcIixcbiAgICAgIG5hbWU6IFwiRmluZDogTWFrZSBTbWFydCBDb25uZWN0aW9uc1wiLFxuICAgICAgaWNvbjogXCJwZW5jaWxfaWNvblwiLFxuICAgICAgaG90a2V5czogW10sXG4gICAgICAvLyBlZGl0b3JDYWxsYmFjazogYXN5bmMgKGVkaXRvcikgPT4ge1xuICAgICAgZWRpdG9yQ2FsbGJhY2s6IGFzeW5jIChlZGl0b3IpID0+IHtcbiAgICAgICAgaWYoZWRpdG9yLnNvbWV0aGluZ1NlbGVjdGVkKCkpIHtcbiAgICAgICAgICAvLyBnZXQgc2VsZWN0ZWQgdGV4dFxuICAgICAgICAgIGxldCBzZWxlY3RlZF90ZXh0ID0gZWRpdG9yLmdldFNlbGVjdGlvbigpO1xuICAgICAgICAgIC8vIHJlbmRlciBjb25uZWN0aW9ucyBmcm9tIHNlbGVjdGVkIHRleHRcbiAgICAgICAgICBhd2FpdCB0aGlzLm1ha2VfY29ubmVjdGlvbnMoc2VsZWN0ZWRfdGV4dCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gY2xlYXIgbmVhcmVzdF9jYWNoZSBvbiBtYW51YWwgY2FsbCB0byBtYWtlIGNvbm5lY3Rpb25zXG4gICAgICAgICAgdGhpcy5uZWFyZXN0X2NhY2hlID0ge307XG4gICAgICAgICAgLy8gY29uc29sZS5sb2coXCJDbGVhcmVkIG5lYXJlc3RfY2FjaGVcIik7XG4gICAgICAgICAgYXdhaXQgdGhpcy5tYWtlX2Nvbm5lY3Rpb25zKCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwic21hcnQtY29ubmVjdGlvbnMtdmlld1wiLFxuICAgICAgbmFtZTogXCJPcGVuOiBWaWV3IFNtYXJ0IENvbm5lY3Rpb25zXCIsXG4gICAgICBjYWxsYmFjazogKCkgPT4ge1xuICAgICAgICB0aGlzLm9wZW5fdmlldygpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIC8vIG9wZW4gY2hhdCBjb21tYW5kXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcInNtYXJ0LWNvbm5lY3Rpb25zLWNoYXRcIixcbiAgICAgIG5hbWU6IFwiT3BlbjogU21hcnQgQ2hhdCBDb252ZXJzYXRpb25cIixcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB7XG4gICAgICAgIHRoaXMub3Blbl9jaGF0KCk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgLy8gb3BlbiByYW5kb20gbm90ZSBmcm9tIG5lYXJlc3QgY2FjaGVcbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwic21hcnQtY29ubmVjdGlvbnMtcmFuZG9tXCIsXG4gICAgICBuYW1lOiBcIk9wZW46IFJhbmRvbSBOb3RlIGZyb20gU21hcnQgQ29ubmVjdGlvbnNcIixcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB7XG4gICAgICAgIHRoaXMub3Blbl9yYW5kb21fbm90ZSgpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIC8vIGFkZCBzZXR0aW5ncyB0YWJcbiAgICB0aGlzLmFkZFNldHRpbmdUYWIobmV3IFNtYXJ0Q29ubmVjdGlvbnNTZXR0aW5nc1RhYih0aGlzLmFwcCwgdGhpcykpO1xuICAgIC8vIHJlZ2lzdGVyIG1haW4gdmlldyB0eXBlXG4gICAgdGhpcy5yZWdpc3RlclZpZXcoU01BUlRfQ09OTkVDVElPTlNfVklFV19UWVBFLCAobGVhZikgPT4gKG5ldyBTbWFydENvbm5lY3Rpb25zVmlldyhsZWFmLCB0aGlzKSkpO1xuICAgIC8vIHJlZ2lzdGVyIGNoYXQgdmlldyB0eXBlXG4gICAgdGhpcy5yZWdpc3RlclZpZXcoU01BUlRfQ09OTkVDVElPTlNfQ0hBVF9WSUVXX1RZUEUsIChsZWFmKSA9PiAobmV3IFNtYXJ0Q29ubmVjdGlvbnNDaGF0VmlldyhsZWFmLCB0aGlzKSkpO1xuICAgIC8vIGNvZGUtYmxvY2sgcmVuZGVyZXJcbiAgICB0aGlzLnJlZ2lzdGVyTWFya2Rvd25Db2RlQmxvY2tQcm9jZXNzb3IoXCJzbWFydC1jb25uZWN0aW9uc1wiLCB0aGlzLnJlbmRlcl9jb2RlX2Jsb2NrLmJpbmQodGhpcykpO1xuXG4gICAgLy8gaWYgdGhpcyBzZXR0aW5ncy52aWV3X29wZW4gaXMgdHJ1ZSwgb3BlbiB2aWV3IG9uIHN0YXJ0dXBcbiAgICBpZih0aGlzLnNldHRpbmdzLnZpZXdfb3Blbikge1xuICAgICAgdGhpcy5vcGVuX3ZpZXcoKTtcbiAgICB9XG4gICAgLy8gaWYgdGhpcyBzZXR0aW5ncy5jaGF0X29wZW4gaXMgdHJ1ZSwgb3BlbiBjaGF0IG9uIHN0YXJ0dXBcbiAgICBpZih0aGlzLnNldHRpbmdzLmNoYXRfb3Blbikge1xuICAgICAgdGhpcy5vcGVuX2NoYXQoKTtcbiAgICB9XG4gICAgLy8gb24gbmV3IHZlcnNpb25cbiAgICBpZih0aGlzLnNldHRpbmdzLnZlcnNpb24gIT09IFZFUlNJT04pIHtcbiAgICAgIC8vIHVwZGF0ZSB2ZXJzaW9uXG4gICAgICB0aGlzLnNldHRpbmdzLnZlcnNpb24gPSBWRVJTSU9OO1xuICAgICAgLy8gc2F2ZSBzZXR0aW5nc1xuICAgICAgYXdhaXQgdGhpcy5zYXZlU2V0dGluZ3MoKTtcbiAgICAgIC8vIG9wZW4gdmlld1xuICAgICAgdGhpcy5vcGVuX3ZpZXcoKTtcbiAgICB9XG4gICAgLy8gY2hlY2sgZ2l0aHViIHJlbGVhc2UgZW5kcG9pbnQgaWYgdXBkYXRlIGlzIGF2YWlsYWJsZVxuICAgIHRoaXMuYWRkX3RvX2dpdGlnbm9yZSgpO1xuICAgIC8qKlxuICAgICAqIEVYUEVSSU1FTlRBTFxuICAgICAqIC0gd2luZG93LWJhc2VkIEFQSSBhY2Nlc3NcbiAgICAgKiAtIGNvZGUtYmxvY2sgcmVuZGVyaW5nXG4gICAgICovXG4gICAgdGhpcy5hcGkgPSBuZXcgU2NTZWFyY2hBcGkodGhpcy5hcHAsIHRoaXMpO1xuICAgIC8vIHJlZ2lzdGVyIEFQSSB0byBnbG9iYWwgd2luZG93IG9iamVjdFxuICAgICh3aW5kb3dbXCJTbWFydFNlYXJjaEFwaVwiXSA9IHRoaXMuYXBpKSAmJiB0aGlzLnJlZ2lzdGVyKCgpID0+IGRlbGV0ZSB3aW5kb3dbXCJTbWFydFNlYXJjaEFwaVwiXSk7XG5cbiAgfVxuXG4gIGFzeW5jIGluaXRfdmVjcygpIHtcbiAgICB0aGlzLnNtYXJ0X3ZlY19saXRlID0gbmV3IFZlY0xpdGUoe1xuICAgICAgZm9sZGVyX3BhdGg6IFwiLnNtYXJ0LWNvbm5lY3Rpb25zXCIsXG4gICAgICBleGlzdHNfYWRhcHRlcjogdGhpcy5hcHAudmF1bHQuYWRhcHRlci5leGlzdHMuYmluZCh0aGlzLmFwcC52YXVsdC5hZGFwdGVyKSxcbiAgICAgIG1rZGlyX2FkYXB0ZXI6IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIubWtkaXIuYmluZCh0aGlzLmFwcC52YXVsdC5hZGFwdGVyKSxcbiAgICAgIHJlYWRfYWRhcHRlcjogdGhpcy5hcHAudmF1bHQuYWRhcHRlci5yZWFkLmJpbmQodGhpcy5hcHAudmF1bHQuYWRhcHRlciksXG4gICAgICByZW5hbWVfYWRhcHRlcjogdGhpcy5hcHAudmF1bHQuYWRhcHRlci5yZW5hbWUuYmluZCh0aGlzLmFwcC52YXVsdC5hZGFwdGVyKSxcbiAgICAgIHN0YXRfYWRhcHRlcjogdGhpcy5hcHAudmF1bHQuYWRhcHRlci5zdGF0LmJpbmQodGhpcy5hcHAudmF1bHQuYWRhcHRlciksXG4gICAgICB3cml0ZV9hZGFwdGVyOiB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLndyaXRlLmJpbmQodGhpcy5hcHAudmF1bHQuYWRhcHRlciksXG4gICAgfSk7XG4gICAgdGhpcy5lbWJlZGRpbmdzX2xvYWRlZCA9IGF3YWl0IHRoaXMuc21hcnRfdmVjX2xpdGUubG9hZCgpO1xuICAgIHJldHVybiB0aGlzLmVtYmVkZGluZ3NfbG9hZGVkO1xuICB9XG5cbiAgYXN5bmMgbG9hZFNldHRpbmdzKCkge1xuICAgIHRoaXMuc2V0dGluZ3MgPSBPYmplY3QuYXNzaWduKHt9LCBERUZBVUxUX1NFVFRJTkdTLCBhd2FpdCB0aGlzLmxvYWREYXRhKCkpO1xuICAgIC8vIGxvYWQgZmlsZSBleGNsdXNpb25zIGlmIG5vdCBibGFua1xuICAgIGlmKHRoaXMuc2V0dGluZ3MuZmlsZV9leGNsdXNpb25zICYmIHRoaXMuc2V0dGluZ3MuZmlsZV9leGNsdXNpb25zLmxlbmd0aCA+IDApIHtcbiAgICAgIC8vIHNwbGl0IGZpbGUgZXhjbHVzaW9ucyBpbnRvIGFycmF5IGFuZCB0cmltIHdoaXRlc3BhY2VcbiAgICAgIHRoaXMuZmlsZV9leGNsdXNpb25zID0gdGhpcy5zZXR0aW5ncy5maWxlX2V4Y2x1c2lvbnMuc3BsaXQoXCIsXCIpLm1hcCgoZmlsZSkgPT4ge1xuICAgICAgICByZXR1cm4gZmlsZS50cmltKCk7XG4gICAgICB9KTtcbiAgICB9XG4gICAgLy8gbG9hZCBmb2xkZXIgZXhjbHVzaW9ucyBpZiBub3QgYmxhbmtcbiAgICBpZih0aGlzLnNldHRpbmdzLmZvbGRlcl9leGNsdXNpb25zICYmIHRoaXMuc2V0dGluZ3MuZm9sZGVyX2V4Y2x1c2lvbnMubGVuZ3RoID4gMCkge1xuICAgICAgLy8gYWRkIHNsYXNoIHRvIGVuZCBvZiBmb2xkZXIgbmFtZSBpZiBub3QgcHJlc2VudFxuICAgICAgY29uc3QgZm9sZGVyX2V4Y2x1c2lvbnMgPSB0aGlzLnNldHRpbmdzLmZvbGRlcl9leGNsdXNpb25zLnNwbGl0KFwiLFwiKS5tYXAoKGZvbGRlcikgPT4ge1xuICAgICAgICAvLyB0cmltIHdoaXRlc3BhY2VcbiAgICAgICAgZm9sZGVyID0gZm9sZGVyLnRyaW0oKTtcbiAgICAgICAgaWYoZm9sZGVyLnNsaWNlKC0xKSAhPT0gXCIvXCIpIHtcbiAgICAgICAgICByZXR1cm4gZm9sZGVyICsgXCIvXCI7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmV0dXJuIGZvbGRlcjtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICAvLyBtZXJnZSBmb2xkZXIgZXhjbHVzaW9ucyB3aXRoIGZpbGUgZXhjbHVzaW9uc1xuICAgICAgdGhpcy5maWxlX2V4Y2x1c2lvbnMgPSB0aGlzLmZpbGVfZXhjbHVzaW9ucy5jb25jYXQoZm9sZGVyX2V4Y2x1c2lvbnMpO1xuICAgIH1cbiAgICAvLyBsb2FkIGhlYWRlciBleGNsdXNpb25zIGlmIG5vdCBibGFua1xuICAgIGlmKHRoaXMuc2V0dGluZ3MuaGVhZGVyX2V4Y2x1c2lvbnMgJiYgdGhpcy5zZXR0aW5ncy5oZWFkZXJfZXhjbHVzaW9ucy5sZW5ndGggPiAwKSB7XG4gICAgICB0aGlzLmhlYWRlcl9leGNsdXNpb25zID0gdGhpcy5zZXR0aW5ncy5oZWFkZXJfZXhjbHVzaW9ucy5zcGxpdChcIixcIikubWFwKChoZWFkZXIpID0+IHtcbiAgICAgICAgcmV0dXJuIGhlYWRlci50cmltKCk7XG4gICAgICB9KTtcbiAgICB9XG4gICAgLy8gbG9hZCBwYXRoX29ubHkgaWYgbm90IGJsYW5rXG4gICAgaWYodGhpcy5zZXR0aW5ncy5wYXRoX29ubHkgJiYgdGhpcy5zZXR0aW5ncy5wYXRoX29ubHkubGVuZ3RoID4gMCkge1xuICAgICAgdGhpcy5wYXRoX29ubHkgPSB0aGlzLnNldHRpbmdzLnBhdGhfb25seS5zcGxpdChcIixcIikubWFwKChwYXRoKSA9PiB7XG4gICAgICAgIHJldHVybiBwYXRoLnRyaW0oKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICAvLyBsb2FkIHNlbGZfcmVmX2t3X3JlZ2V4XG4gICAgdGhpcy5zZWxmX3JlZl9rd19yZWdleCA9IG5ldyBSZWdFeHAoYFxcXFxiKCR7U01BUlRfVFJBTlNMQVRJT05bdGhpcy5zZXR0aW5ncy5sYW5ndWFnZV0ucHJvbm91cy5qb2luKFwifFwiKX0pXFxcXGJgLCBcImdpXCIpO1xuICAgIC8vIGxvYWQgZmFpbGVkIGZpbGVzXG4gICAgYXdhaXQgdGhpcy5sb2FkX2ZhaWxlZF9maWxlcygpO1xuICB9XG4gIGFzeW5jIHNhdmVTZXR0aW5ncyhyZXJlbmRlcj1mYWxzZSkge1xuICAgIGF3YWl0IHRoaXMuc2F2ZURhdGEodGhpcy5zZXR0aW5ncyk7XG4gICAgLy8gcmUtbG9hZCBzZXR0aW5ncyBpbnRvIG1lbW9yeVxuICAgIGF3YWl0IHRoaXMubG9hZFNldHRpbmdzKCk7XG4gICAgLy8gcmUtcmVuZGVyIHZpZXcgaWYgc2V0IHRvIHRydWUgKGZvciBleGFtcGxlLCBhZnRlciBhZGRpbmcgQVBJIGtleSlcbiAgICBpZihyZXJlbmRlcikge1xuICAgICAgdGhpcy5uZWFyZXN0X2NhY2hlID0ge307XG4gICAgICBhd2FpdCB0aGlzLm1ha2VfY29ubmVjdGlvbnMoKTtcbiAgICB9XG4gIH1cblxuICAvLyBjaGVjayBmb3IgdXBkYXRlXG4gIGFzeW5jIGNoZWNrX2Zvcl91cGRhdGUoKSB7XG4gICAgLy8gZmFpbCBzaWxlbnRseSwgZXguIGlmIG5vIGludGVybmV0IGNvbm5lY3Rpb25cbiAgICB0cnkge1xuICAgICAgLy8gZ2V0IGxhdGVzdCByZWxlYXNlIHZlcnNpb24gZnJvbSBnaXRodWJcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgKDAsIE9ic2lkaWFuLnJlcXVlc3RVcmwpKHtcbiAgICAgICAgdXJsOiBcImh0dHBzOi8vYXBpLmdpdGh1Yi5jb20vcmVwb3MvYnJpYW5wZXRyby9vYnNpZGlhbi1zbWFydC1jb25uZWN0aW9ucy9yZWxlYXNlcy9sYXRlc3RcIixcbiAgICAgICAgbWV0aG9kOiBcIkdFVFwiLFxuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gICAgICAgIH0sXG4gICAgICAgIGNvbnRlbnRUeXBlOiBcImFwcGxpY2F0aW9uL2pzb25cIixcbiAgICAgIH0pO1xuICAgICAgLy8gZ2V0IHZlcnNpb24gbnVtYmVyIGZyb20gcmVzcG9uc2VcbiAgICAgIGNvbnN0IGxhdGVzdF9yZWxlYXNlID0gSlNPTi5wYXJzZShyZXNwb25zZS50ZXh0KS50YWdfbmFtZTtcbiAgICAgIC8vIGNvbnNvbGUubG9nKGBMYXRlc3QgcmVsZWFzZTogJHtsYXRlc3RfcmVsZWFzZX1gKTtcbiAgICAgIC8vIGlmIGxhdGVzdF9yZWxlYXNlIGlzIG5ld2VyIHRoYW4gY3VycmVudCB2ZXJzaW9uLCBzaG93IG1lc3NhZ2VcbiAgICAgIGlmKGxhdGVzdF9yZWxlYXNlICE9PSBWRVJTSU9OKSB7XG4gICAgICAgIG5ldyBPYnNpZGlhbi5Ob3RpY2UoYFtTbWFydCBDb25uZWN0aW9uc10gQSBuZXcgdmVyc2lvbiBpcyBhdmFpbGFibGUhICh2JHtsYXRlc3RfcmVsZWFzZX0pYCk7XG4gICAgICAgIHRoaXMudXBkYXRlX2F2YWlsYWJsZSA9IHRydWU7XG4gICAgICAgIHRoaXMucmVuZGVyX2JyYW5kKFwiYWxsXCIpXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUubG9nKGVycm9yKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyByZW5kZXJfY29kZV9ibG9jayhjb250ZW50cywgY29udGFpbmVyLCBjdHgpIHtcbiAgICBsZXQgbmVhcmVzdDtcbiAgICBpZihjb250ZW50cy50cmltKCkubGVuZ3RoID4gMCkge1xuICAgICAgbmVhcmVzdCA9IGF3YWl0IHRoaXMuYXBpLnNlYXJjaChjb250ZW50cyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIHVzZSBjdHggdG8gZ2V0IGZpbGVcbiAgICAgIGNvbnNvbGUubG9nKGN0eCk7XG4gICAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGN0eC5zb3VyY2VQYXRoKTtcbiAgICAgIG5lYXJlc3QgPSBhd2FpdCB0aGlzLmZpbmRfbm90ZV9jb25uZWN0aW9ucyhmaWxlKTtcbiAgICB9XG4gICAgaWYgKG5lYXJlc3QubGVuZ3RoKSB7XG4gICAgICB0aGlzLnVwZGF0ZV9yZXN1bHRzKGNvbnRhaW5lciwgbmVhcmVzdCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgbWFrZV9jb25uZWN0aW9ucyhzZWxlY3RlZF90ZXh0PW51bGwpIHtcbiAgICBsZXQgdmlldyA9IHRoaXMuZ2V0X3ZpZXcoKTtcbiAgICBpZiAoIXZpZXcpIHtcbiAgICAgIC8vIG9wZW4gdmlldyBpZiBub3Qgb3BlblxuICAgICAgYXdhaXQgdGhpcy5vcGVuX3ZpZXcoKTtcbiAgICAgIHZpZXcgPSB0aGlzLmdldF92aWV3KCk7XG4gICAgfVxuICAgIGF3YWl0IHZpZXcucmVuZGVyX2Nvbm5lY3Rpb25zKHNlbGVjdGVkX3RleHQpO1xuICB9XG5cbiAgYWRkSWNvbigpe1xuICAgIE9ic2lkaWFuLmFkZEljb24oXCJzbWFydC1jb25uZWN0aW9uc1wiLCBgPHBhdGggZD1cIk01MCwyMCBMODAsNDAgTDgwLDYwIEw1MCwxMDBcIiBzdHJva2U9XCJjdXJyZW50Q29sb3JcIiBzdHJva2Utd2lkdGg9XCI0XCIgZmlsbD1cIm5vbmVcIi8+XG4gICAgPHBhdGggZD1cIk0zMCw1MCBMNTUsNzBcIiBzdHJva2U9XCJjdXJyZW50Q29sb3JcIiBzdHJva2Utd2lkdGg9XCI1XCIgZmlsbD1cIm5vbmVcIi8+XG4gICAgPGNpcmNsZSBjeD1cIjUwXCIgY3k9XCIyMFwiIHI9XCI5XCIgZmlsbD1cImN1cnJlbnRDb2xvclwiLz5cbiAgICA8Y2lyY2xlIGN4PVwiODBcIiBjeT1cIjQwXCIgcj1cIjlcIiBmaWxsPVwiY3VycmVudENvbG9yXCIvPlxuICAgIDxjaXJjbGUgY3g9XCI4MFwiIGN5PVwiNzBcIiByPVwiOVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIi8+XG4gICAgPGNpcmNsZSBjeD1cIjUwXCIgY3k9XCIxMDBcIiByPVwiOVwiIGZpbGw9XCJjdXJyZW50Q29sb3JcIi8+XG4gICAgPGNpcmNsZSBjeD1cIjMwXCIgY3k9XCI1MFwiIHI9XCI5XCIgZmlsbD1cImN1cnJlbnRDb2xvclwiLz5gKTtcbiAgfVxuXG4gIC8vIG9wZW4gcmFuZG9tIG5vdGVcbiAgYXN5bmMgb3Blbl9yYW5kb21fbm90ZSgpIHtcbiAgICBjb25zdCBjdXJyX2ZpbGUgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpO1xuICAgIGNvbnN0IGN1cnJfa2V5ID0gbWQ1KGN1cnJfZmlsZS5wYXRoKTtcbiAgICAvLyBpZiBubyBuZWFyZXN0IGNhY2hlLCBjcmVhdGUgT2JzaWRpYW4gbm90aWNlXG4gICAgaWYodHlwZW9mIHRoaXMubmVhcmVzdF9jYWNoZVtjdXJyX2tleV0gPT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICAgIG5ldyBPYnNpZGlhbi5Ob3RpY2UoXCJbU21hcnQgQ29ubmVjdGlvbnNdIE5vIFNtYXJ0IENvbm5lY3Rpb25zIGZvdW5kLiBPcGVuIGEgbm90ZSB0byBnZXQgU21hcnQgQ29ubmVjdGlvbnMuXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICAvLyBnZXQgcmFuZG9tIGZyb20gbmVhcmVzdCBjYWNoZVxuICAgIGNvbnN0IHJhbmQgPSBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiB0aGlzLm5lYXJlc3RfY2FjaGVbY3Vycl9rZXldLmxlbmd0aC8yKTsgLy8gZGl2aWRlIGJ5IDIgdG8gbGltaXQgdG8gdG9wIGhhbGYgb2YgcmVzdWx0c1xuICAgIGNvbnN0IHJhbmRvbV9maWxlID0gdGhpcy5uZWFyZXN0X2NhY2hlW2N1cnJfa2V5XVtyYW5kXTtcbiAgICAvLyBvcGVuIHJhbmRvbSBmaWxlXG4gICAgdGhpcy5vcGVuX25vdGUocmFuZG9tX2ZpbGUpO1xuICB9XG5cbiAgYXN5bmMgb3Blbl92aWV3KCkge1xuICAgIGlmKHRoaXMuZ2V0X3ZpZXcoKSl7XG4gICAgICBjb25zb2xlLmxvZyhcIlNtYXJ0IENvbm5lY3Rpb25zIHZpZXcgYWxyZWFkeSBvcGVuXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLmFwcC53b3Jrc3BhY2UuZGV0YWNoTGVhdmVzT2ZUeXBlKFNNQVJUX0NPTk5FQ1RJT05TX1ZJRVdfVFlQRSk7XG4gICAgYXdhaXQgdGhpcy5hcHAud29ya3NwYWNlLmdldFJpZ2h0TGVhZihmYWxzZSkuc2V0Vmlld1N0YXRlKHtcbiAgICAgIHR5cGU6IFNNQVJUX0NPTk5FQ1RJT05TX1ZJRVdfVFlQRSxcbiAgICAgIGFjdGl2ZTogdHJ1ZSxcbiAgICB9KTtcbiAgICB0aGlzLmFwcC53b3Jrc3BhY2UucmV2ZWFsTGVhZihcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoU01BUlRfQ09OTkVDVElPTlNfVklFV19UWVBFKVswXVxuICAgICk7XG4gIH1cbiAgLy8gc291cmNlOiBodHRwczovL2dpdGh1Yi5jb20vb2JzaWRpYW5tZC9vYnNpZGlhbi1yZWxlYXNlcy9ibG9iL21hc3Rlci9wbHVnaW4tcmV2aWV3Lm1kI2F2b2lkLW1hbmFnaW5nLXJlZmVyZW5jZXMtdG8tY3VzdG9tLXZpZXdzXG4gIGdldF92aWV3KCkge1xuICAgIGZvciAobGV0IGxlYWYgb2YgdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShTTUFSVF9DT05ORUNUSU9OU19WSUVXX1RZUEUpKSB7XG4gICAgICBpZiAobGVhZi52aWV3IGluc3RhbmNlb2YgU21hcnRDb25uZWN0aW9uc1ZpZXcpIHtcbiAgICAgICAgcmV0dXJuIGxlYWYudmlldztcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgLy8gb3BlbiBjaGF0IHZpZXdcbiAgYXN5bmMgb3Blbl9jaGF0KHJldHJpZXM9MCkge1xuICAgIGlmKCF0aGlzLmVtYmVkZGluZ3NfbG9hZGVkKSB7XG4gICAgICBjb25zb2xlLmxvZyhcImVtYmVkZGluZ3Mgbm90IGxvYWRlZCB5ZXRcIik7XG4gICAgICBpZihyZXRyaWVzIDwgMykge1xuICAgICAgICAvLyB3YWl0IGFuZCB0cnkgYWdhaW5cbiAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgdGhpcy5vcGVuX2NoYXQocmV0cmllcysxKTtcbiAgICAgICAgfSwgMTAwMCAqIChyZXRyaWVzKzEpKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgY29uc29sZS5sb2coXCJlbWJlZGRpbmdzIHN0aWxsIG5vdCBsb2FkZWQsIG9wZW5pbmcgc21hcnQgdmlld1wiKTtcbiAgICAgIHRoaXMub3Blbl92aWV3KCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5kZXRhY2hMZWF2ZXNPZlR5cGUoU01BUlRfQ09OTkVDVElPTlNfQ0hBVF9WSUVXX1RZUEUpO1xuICAgIGF3YWl0IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRSaWdodExlYWYoZmFsc2UpLnNldFZpZXdTdGF0ZSh7XG4gICAgICB0eXBlOiBTTUFSVF9DT05ORUNUSU9OU19DSEFUX1ZJRVdfVFlQRSxcbiAgICAgIGFjdGl2ZTogdHJ1ZSxcbiAgICB9KTtcbiAgICB0aGlzLmFwcC53b3Jrc3BhY2UucmV2ZWFsTGVhZihcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoU01BUlRfQ09OTkVDVElPTlNfQ0hBVF9WSUVXX1RZUEUpWzBdXG4gICAgKTtcbiAgfVxuICBcbiAgLy8gZ2V0IGVtYmVkZGluZ3MgZm9yIGFsbCBmaWxlc1xuICBhc3luYyBnZXRfYWxsX2VtYmVkZGluZ3MoKSB7XG4gICAgLy8gZ2V0IGFsbCBmaWxlcyBpbiB2YXVsdCBhbmQgZmlsdGVyIGFsbCBidXQgbWFya2Rvd24gYW5kIGNhbnZhcyBmaWxlc1xuICAgIGNvbnN0IGZpbGVzID0gKGF3YWl0IHRoaXMuYXBwLnZhdWx0LmdldEZpbGVzKCkpLmZpbHRlcigoZmlsZSkgPT4gZmlsZSBpbnN0YW5jZW9mIE9ic2lkaWFuLlRGaWxlICYmIChmaWxlLmV4dGVuc2lvbiA9PT0gXCJtZFwiIHx8IGZpbGUuZXh0ZW5zaW9uID09PSBcImNhbnZhc1wiKSk7XG4gICAgLy8gY29uc3QgZmlsZXMgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5nZXRNYXJrZG93bkZpbGVzKCk7XG4gICAgLy8gZ2V0IG9wZW4gZmlsZXMgdG8gc2tpcCBpZiBmaWxlIGlzIGN1cnJlbnRseSBvcGVuXG4gICAgY29uc3Qgb3Blbl9maWxlcyA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJtYXJrZG93blwiKS5tYXAoKGxlYWYpID0+IGxlYWYudmlldy5maWxlKTtcbiAgICBjb25zdCBjbGVhbl91cF9sb2cgPSB0aGlzLnNtYXJ0X3ZlY19saXRlLmNsZWFuX3VwX2VtYmVkZGluZ3MoZmlsZXMpO1xuICAgIGlmKHRoaXMuc2V0dGluZ3MubG9nX3JlbmRlcil7XG4gICAgICB0aGlzLnJlbmRlcl9sb2cudG90YWxfZmlsZXMgPSBmaWxlcy5sZW5ndGg7XG4gICAgICB0aGlzLnJlbmRlcl9sb2cuZGVsZXRlZF9lbWJlZGRpbmdzID0gY2xlYW5fdXBfbG9nLmRlbGV0ZWRfZW1iZWRkaW5ncztcbiAgICAgIHRoaXMucmVuZGVyX2xvZy50b3RhbF9lbWJlZGRpbmdzID0gY2xlYW5fdXBfbG9nLnRvdGFsX2VtYmVkZGluZ3M7XG4gICAgfVxuICAgIC8vIGJhdGNoIGVtYmVkZGluZ3NcbiAgICBsZXQgYmF0Y2hfcHJvbWlzZXMgPSBbXTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGZpbGVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAvLyBza2lwIGlmIHBhdGggY29udGFpbnMgYSAjXG4gICAgICBpZihmaWxlc1tpXS5wYXRoLmluZGV4T2YoXCIjXCIpID4gLTEpIHtcbiAgICAgICAgLy8gY29uc29sZS5sb2coXCJza2lwcGluZyBmaWxlICdcIitmaWxlc1tpXS5wYXRoK1wiJyAocGF0aCBjb250YWlucyAjKVwiKTtcbiAgICAgICAgdGhpcy5sb2dfZXhjbHVzaW9uKFwicGF0aCBjb250YWlucyAjXCIpO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIC8vIHNraXAgaWYgZmlsZSBhbHJlYWR5IGhhcyBlbWJlZGRpbmcgYW5kIGVtYmVkZGluZy5tdGltZSBpcyBncmVhdGVyIHRoYW4gb3IgZXF1YWwgdG8gZmlsZS5tdGltZVxuICAgICAgaWYodGhpcy5zbWFydF92ZWNfbGl0ZS5tdGltZV9pc19jdXJyZW50KG1kNShmaWxlc1tpXS5wYXRoKSwgZmlsZXNbaV0uc3RhdC5tdGltZSkpIHtcbiAgICAgICAgLy8gbG9nIHNraXBwaW5nIGZpbGVcbiAgICAgICAgLy8gY29uc29sZS5sb2coXCJza2lwcGluZyBmaWxlIChtdGltZSlcIik7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgLy8gY2hlY2sgaWYgZmlsZSBpcyBpbiBmYWlsZWRfZmlsZXNcbiAgICAgIGlmKHRoaXMuc2V0dGluZ3MuZmFpbGVkX2ZpbGVzLmluZGV4T2YoZmlsZXNbaV0ucGF0aCkgPiAtMSkge1xuICAgICAgICAvLyBsb2cgc2tpcHBpbmcgZmlsZVxuICAgICAgICAvLyBjb25zb2xlLmxvZyhcInNraXBwaW5nIHByZXZpb3VzbHkgZmFpbGVkIGZpbGUsIHVzZSBidXR0b24gaW4gc2V0dGluZ3MgdG8gcmV0cnlcIik7XG4gICAgICAgIC8vIHVzZSBzZXRUaW1lb3V0IHRvIHByZXZlbnQgbXVsdGlwbGUgbm90aWNlc1xuICAgICAgICBpZih0aGlzLnJldHJ5X25vdGljZV90aW1lb3V0KSB7XG4gICAgICAgICAgY2xlYXJUaW1lb3V0KHRoaXMucmV0cnlfbm90aWNlX3RpbWVvdXQpO1xuICAgICAgICAgIHRoaXMucmV0cnlfbm90aWNlX3RpbWVvdXQgPSBudWxsO1xuICAgICAgICB9XG4gICAgICAgIC8vIGxpbWl0IHRvIG9uZSBub3RpY2UgZXZlcnkgMTAgbWludXRlc1xuICAgICAgICBpZighdGhpcy5yZWNlbnRseV9zZW50X3JldHJ5X25vdGljZSl7XG4gICAgICAgICAgbmV3IE9ic2lkaWFuLk5vdGljZShcIlNtYXJ0IENvbm5lY3Rpb25zOiBTa2lwcGluZyBwcmV2aW91c2x5IGZhaWxlZCBmaWxlLCB1c2UgYnV0dG9uIGluIHNldHRpbmdzIHRvIHJldHJ5XCIpO1xuICAgICAgICAgIHRoaXMucmVjZW50bHlfc2VudF9yZXRyeV9ub3RpY2UgPSB0cnVlO1xuICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5yZWNlbnRseV9zZW50X3JldHJ5X25vdGljZSA9IGZhbHNlOyAgXG4gICAgICAgICAgfSwgNjAwMDAwKTtcbiAgICAgICAgfVxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIC8vIHNraXAgZmlsZXMgd2hlcmUgcGF0aCBjb250YWlucyBhbnkgZXhjbHVzaW9uc1xuICAgICAgbGV0IHNraXAgPSBmYWxzZTtcbiAgICAgIGZvcihsZXQgaiA9IDA7IGogPCB0aGlzLmZpbGVfZXhjbHVzaW9ucy5sZW5ndGg7IGorKykge1xuICAgICAgICBpZihmaWxlc1tpXS5wYXRoLmluZGV4T2YodGhpcy5maWxlX2V4Y2x1c2lvbnNbal0pID4gLTEpIHtcbiAgICAgICAgICBza2lwID0gdHJ1ZTtcbiAgICAgICAgICB0aGlzLmxvZ19leGNsdXNpb24odGhpcy5maWxlX2V4Y2x1c2lvbnNbal0pO1xuICAgICAgICAgIC8vIGJyZWFrIG91dCBvZiBsb29wXG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmKHNraXApIHtcbiAgICAgICAgY29udGludWU7IC8vIHRvIG5leHQgZmlsZVxuICAgICAgfVxuICAgICAgLy8gY2hlY2sgaWYgZmlsZSBpcyBvcGVuXG4gICAgICBpZihvcGVuX2ZpbGVzLmluZGV4T2YoZmlsZXNbaV0pID4gLTEpIHtcbiAgICAgICAgLy8gY29uc29sZS5sb2coXCJza2lwcGluZyBmaWxlIChvcGVuKVwiKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICB0cnkge1xuICAgICAgICAvLyBwdXNoIHByb21pc2UgdG8gYmF0Y2hfcHJvbWlzZXNcbiAgICAgICAgYmF0Y2hfcHJvbWlzZXMucHVzaCh0aGlzLmdldF9maWxlX2VtYmVkZGluZ3MoZmlsZXNbaV0sIGZhbHNlKSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmxvZyhlcnJvcik7XG4gICAgICB9XG4gICAgICAvLyBpZiBiYXRjaF9wcm9taXNlcyBsZW5ndGggaXMgMTBcbiAgICAgIGlmKGJhdGNoX3Byb21pc2VzLmxlbmd0aCA+IDMpIHtcbiAgICAgICAgLy8gd2FpdCBmb3IgYWxsIHByb21pc2VzIHRvIHJlc29sdmVcbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoYmF0Y2hfcHJvbWlzZXMpO1xuICAgICAgICAvLyBjbGVhciBiYXRjaF9wcm9taXNlc1xuICAgICAgICBiYXRjaF9wcm9taXNlcyA9IFtdO1xuICAgICAgfVxuXG4gICAgICAvLyBzYXZlIGVtYmVkZGluZ3MgSlNPTiB0byBmaWxlIGV2ZXJ5IDEwMCBmaWxlcyB0byBzYXZlIHByb2dyZXNzIG9uIGJ1bGsgZW1iZWRkaW5nXG4gICAgICBpZihpID4gMCAmJiBpICUgMTAwID09PSAwKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuc2F2ZV9lbWJlZGRpbmdzX3RvX2ZpbGUoKTtcbiAgICAgIH1cbiAgICB9XG4gICAgLy8gd2FpdCBmb3IgYWxsIHByb21pc2VzIHRvIHJlc29sdmVcbiAgICBhd2FpdCBQcm9taXNlLmFsbChiYXRjaF9wcm9taXNlcyk7XG4gICAgLy8gd3JpdGUgZW1iZWRkaW5ncyBKU09OIHRvIGZpbGVcbiAgICBhd2FpdCB0aGlzLnNhdmVfZW1iZWRkaW5nc190b19maWxlKCk7XG4gICAgLy8gaWYgcmVuZGVyX2xvZy5mYWlsZWRfZW1iZWRkaW5ncyB0aGVuIHVwZGF0ZSBmYWlsZWRfZW1iZWRkaW5ncy50eHRcbiAgICBpZih0aGlzLnJlbmRlcl9sb2cuZmFpbGVkX2VtYmVkZGluZ3MubGVuZ3RoID4gMCkge1xuICAgICAgYXdhaXQgdGhpcy5zYXZlX2ZhaWxlZF9lbWJlZGRpbmdzKCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgc2F2ZV9lbWJlZGRpbmdzX3RvX2ZpbGUoZm9yY2U9ZmFsc2UpIHtcbiAgICBpZighdGhpcy5oYXNfbmV3X2VtYmVkZGluZ3Mpe1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICAvLyBjb25zb2xlLmxvZyhcIm5ldyBlbWJlZGRpbmdzLCBzYXZpbmcgdG8gZmlsZVwiKTtcbiAgICBpZighZm9yY2UpIHtcbiAgICAgIC8vIHByZXZlbnQgZXhjZXNzaXZlIHdyaXRlcyB0byBlbWJlZGRpbmdzIGZpbGUgYnkgd2FpdGluZyAxIG1pbnV0ZSBiZWZvcmUgd3JpdGluZ1xuICAgICAgaWYodGhpcy5zYXZlX3RpbWVvdXQpIHtcbiAgICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuc2F2ZV90aW1lb3V0KTtcbiAgICAgICAgdGhpcy5zYXZlX3RpbWVvdXQgPSBudWxsOyAgXG4gICAgICB9XG4gICAgICB0aGlzLnNhdmVfdGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAvLyBjb25zb2xlLmxvZyhcIndyaXRpbmcgZW1iZWRkaW5ncyB0byBmaWxlXCIpO1xuICAgICAgICB0aGlzLnNhdmVfZW1iZWRkaW5nc190b19maWxlKHRydWUpO1xuICAgICAgICAvLyBjbGVhciB0aW1lb3V0XG4gICAgICAgIGlmKHRoaXMuc2F2ZV90aW1lb3V0KSB7XG4gICAgICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuc2F2ZV90aW1lb3V0KTtcbiAgICAgICAgICB0aGlzLnNhdmVfdGltZW91dCA9IG51bGw7XG4gICAgICAgIH1cbiAgICAgIH0sIDMwMDAwKTtcbiAgICAgIGNvbnNvbGUubG9nKFwic2NoZWR1bGVkIHNhdmVcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdHJ5e1xuICAgICAgLy8gdXNlIHNtYXJ0X3ZlY19saXRlXG4gICAgICBhd2FpdCB0aGlzLnNtYXJ0X3ZlY19saXRlLnNhdmUoKTtcbiAgICAgIHRoaXMuaGFzX25ld19lbWJlZGRpbmdzID0gZmFsc2U7XG4gICAgfWNhdGNoKGVycm9yKXtcbiAgICAgIGNvbnNvbGUubG9nKGVycm9yKTtcbiAgICAgIG5ldyBPYnNpZGlhbi5Ob3RpY2UoXCJTbWFydCBDb25uZWN0aW9uczogXCIrZXJyb3IubWVzc2FnZSk7XG4gICAgfVxuXG4gIH1cbiAgLy8gc2F2ZSBmYWlsZWQgZW1iZWRkaW5ncyB0byBmaWxlIGZyb20gcmVuZGVyX2xvZy5mYWlsZWRfZW1iZWRkaW5nc1xuICBhc3luYyBzYXZlX2ZhaWxlZF9lbWJlZGRpbmdzICgpIHtcbiAgICAvLyB3cml0ZSBmYWlsZWRfZW1iZWRkaW5ncyB0byBmaWxlIG9uZSBsaW5lIHBlciBmYWlsZWQgZW1iZWRkaW5nXG4gICAgbGV0IGZhaWxlZF9lbWJlZGRpbmdzID0gW107XG4gICAgLy8gaWYgZmlsZSBhbHJlYWR5IGV4aXN0cyB0aGVuIHJlYWQgaXRcbiAgICBjb25zdCBmYWlsZWRfZW1iZWRkaW5nc19maWxlX2V4aXN0cyA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIuZXhpc3RzKFwiLnNtYXJ0LWNvbm5lY3Rpb25zL2ZhaWxlZC1lbWJlZGRpbmdzLnR4dFwiKTtcbiAgICBpZihmYWlsZWRfZW1iZWRkaW5nc19maWxlX2V4aXN0cykge1xuICAgICAgZmFpbGVkX2VtYmVkZGluZ3MgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLnJlYWQoXCIuc21hcnQtY29ubmVjdGlvbnMvZmFpbGVkLWVtYmVkZGluZ3MudHh0XCIpO1xuICAgICAgLy8gc3BsaXQgZmFpbGVkX2VtYmVkZGluZ3MgaW50byBhcnJheVxuICAgICAgZmFpbGVkX2VtYmVkZGluZ3MgPSBmYWlsZWRfZW1iZWRkaW5ncy5zcGxpdChcIlxcclxcblwiKTtcbiAgICB9XG4gICAgLy8gbWVyZ2UgZmFpbGVkX2VtYmVkZGluZ3Mgd2l0aCByZW5kZXJfbG9nLmZhaWxlZF9lbWJlZGRpbmdzXG4gICAgZmFpbGVkX2VtYmVkZGluZ3MgPSBmYWlsZWRfZW1iZWRkaW5ncy5jb25jYXQodGhpcy5yZW5kZXJfbG9nLmZhaWxlZF9lbWJlZGRpbmdzKTtcbiAgICAvLyByZW1vdmUgZHVwbGljYXRlc1xuICAgIGZhaWxlZF9lbWJlZGRpbmdzID0gWy4uLm5ldyBTZXQoZmFpbGVkX2VtYmVkZGluZ3MpXTtcbiAgICAvLyBzb3J0IGZhaWxlZF9lbWJlZGRpbmdzIGFycmF5IGFscGhhYmV0aWNhbGx5XG4gICAgZmFpbGVkX2VtYmVkZGluZ3Muc29ydCgpO1xuICAgIC8vIGNvbnZlcnQgZmFpbGVkX2VtYmVkZGluZ3MgYXJyYXkgdG8gc3RyaW5nXG4gICAgZmFpbGVkX2VtYmVkZGluZ3MgPSBmYWlsZWRfZW1iZWRkaW5ncy5qb2luKFwiXFxyXFxuXCIpO1xuICAgIC8vIHdyaXRlIGZhaWxlZF9lbWJlZGRpbmdzIHRvIGZpbGVcbiAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLndyaXRlKFwiLnNtYXJ0LWNvbm5lY3Rpb25zL2ZhaWxlZC1lbWJlZGRpbmdzLnR4dFwiLCBmYWlsZWRfZW1iZWRkaW5ncyk7XG4gICAgLy8gcmVsb2FkIGZhaWxlZF9lbWJlZGRpbmdzIHRvIHByZXZlbnQgcmV0cnlpbmcgZmFpbGVkIGZpbGVzIHVudGlsIGV4cGxpY2l0bHkgcmVxdWVzdGVkXG4gICAgYXdhaXQgdGhpcy5sb2FkX2ZhaWxlZF9maWxlcygpO1xuICB9XG4gIFxuICAvLyBsb2FkIGZhaWxlZCBmaWxlcyBmcm9tIGZhaWxlZC1lbWJlZGRpbmdzLnR4dFxuICBhc3luYyBsb2FkX2ZhaWxlZF9maWxlcyAoKSB7XG4gICAgLy8gY2hlY2sgaWYgZmFpbGVkLWVtYmVkZGluZ3MudHh0IGV4aXN0c1xuICAgIGNvbnN0IGZhaWxlZF9lbWJlZGRpbmdzX2ZpbGVfZXhpc3RzID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci5leGlzdHMoXCIuc21hcnQtY29ubmVjdGlvbnMvZmFpbGVkLWVtYmVkZGluZ3MudHh0XCIpO1xuICAgIGlmKCFmYWlsZWRfZW1iZWRkaW5nc19maWxlX2V4aXN0cykge1xuICAgICAgdGhpcy5zZXR0aW5ncy5mYWlsZWRfZmlsZXMgPSBbXTtcbiAgICAgIGNvbnNvbGUubG9nKFwiTm8gZmFpbGVkIGZpbGVzLlwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgLy8gcmVhZCBmYWlsZWQtZW1iZWRkaW5ncy50eHRcbiAgICBjb25zdCBmYWlsZWRfZW1iZWRkaW5ncyA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIucmVhZChcIi5zbWFydC1jb25uZWN0aW9ucy9mYWlsZWQtZW1iZWRkaW5ncy50eHRcIik7XG4gICAgLy8gc3BsaXQgZmFpbGVkX2VtYmVkZGluZ3MgaW50byBhcnJheSBhbmQgcmVtb3ZlIGVtcHR5IGxpbmVzXG4gICAgY29uc3QgZmFpbGVkX2VtYmVkZGluZ3NfYXJyYXkgPSBmYWlsZWRfZW1iZWRkaW5ncy5zcGxpdChcIlxcclxcblwiKTtcbiAgICAvLyBzcGxpdCBhdCAnIycgYW5kIHJlZHVjZSBpbnRvIHVuaXF1ZSBmaWxlIHBhdGhzXG4gICAgY29uc3QgZmFpbGVkX2ZpbGVzID0gZmFpbGVkX2VtYmVkZGluZ3NfYXJyYXkubWFwKGVtYmVkZGluZyA9PiBlbWJlZGRpbmcuc3BsaXQoXCIjXCIpWzBdKS5yZWR1Y2UoKHVuaXF1ZSwgaXRlbSkgPT4gdW5pcXVlLmluY2x1ZGVzKGl0ZW0pID8gdW5pcXVlIDogWy4uLnVuaXF1ZSwgaXRlbV0sIFtdKTtcbiAgICAvLyByZXR1cm4gZmFpbGVkX2ZpbGVzXG4gICAgdGhpcy5zZXR0aW5ncy5mYWlsZWRfZmlsZXMgPSBmYWlsZWRfZmlsZXM7XG4gICAgLy8gY29uc29sZS5sb2coZmFpbGVkX2ZpbGVzKTtcbiAgfVxuICAvLyByZXRyeSBmYWlsZWQgZW1iZWRkaW5nc1xuICBhc3luYyByZXRyeV9mYWlsZWRfZmlsZXMgKCkge1xuICAgIC8vIHJlbW92ZSBmYWlsZWQgZmlsZXMgZnJvbSBmYWlsZWRfZmlsZXNcbiAgICB0aGlzLnNldHRpbmdzLmZhaWxlZF9maWxlcyA9IFtdO1xuICAgIC8vIGlmIGZhaWxlZC1lbWJlZGRpbmdzLnR4dCBleGlzdHMgdGhlbiBkZWxldGUgaXRcbiAgICBjb25zdCBmYWlsZWRfZW1iZWRkaW5nc19maWxlX2V4aXN0cyA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIuZXhpc3RzKFwiLnNtYXJ0LWNvbm5lY3Rpb25zL2ZhaWxlZC1lbWJlZGRpbmdzLnR4dFwiKTtcbiAgICBpZihmYWlsZWRfZW1iZWRkaW5nc19maWxlX2V4aXN0cykge1xuICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci5yZW1vdmUoXCIuc21hcnQtY29ubmVjdGlvbnMvZmFpbGVkLWVtYmVkZGluZ3MudHh0XCIpO1xuICAgIH1cbiAgICAvLyBydW4gZ2V0IGFsbCBlbWJlZGRpbmdzXG4gICAgYXdhaXQgdGhpcy5nZXRfYWxsX2VtYmVkZGluZ3MoKTtcbiAgfVxuXG5cbiAgLy8gYWRkIC5zbWFydC1jb25uZWN0aW9ucyB0byAuZ2l0aWdub3JlIHRvIHByZXZlbnQgaXNzdWVzIHdpdGggbGFyZ2UsIGZyZXF1ZW50bHkgdXBkYXRlZCBlbWJlZGRpbmdzIGZpbGUocylcbiAgYXN5bmMgYWRkX3RvX2dpdGlnbm9yZSgpIHtcbiAgICBpZighKGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIuZXhpc3RzKFwiLmdpdGlnbm9yZVwiKSkpIHtcbiAgICAgIHJldHVybjsgLy8gaWYgLmdpdGlnbm9yZSBkb2Vzbid0IGV4aXN0IHRoZW4gZG9uJ3QgYWRkIC5zbWFydC1jb25uZWN0aW9ucyB0byAuZ2l0aWdub3JlXG4gICAgfVxuICAgIGxldCBnaXRpZ25vcmVfZmlsZSA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIucmVhZChcIi5naXRpZ25vcmVcIik7XG4gICAgLy8gaWYgLnNtYXJ0LWNvbm5lY3Rpb25zIG5vdCBpbiAuZ2l0aWdub3JlXG4gICAgaWYgKGdpdGlnbm9yZV9maWxlLmluZGV4T2YoXCIuc21hcnQtY29ubmVjdGlvbnNcIikgPCAwKSB7XG4gICAgICAvLyBhZGQgLnNtYXJ0LWNvbm5lY3Rpb25zIHRvIC5naXRpZ25vcmVcbiAgICAgIGxldCBhZGRfdG9fZ2l0aWdub3JlID0gXCJcXG5cXG4jIElnbm9yZSBTbWFydCBDb25uZWN0aW9ucyBmb2xkZXIgYmVjYXVzZSBlbWJlZGRpbmdzIGZpbGUgaXMgbGFyZ2UgYW5kIHVwZGF0ZWQgZnJlcXVlbnRseVwiO1xuICAgICAgYWRkX3RvX2dpdGlnbm9yZSArPSBcIlxcbi5zbWFydC1jb25uZWN0aW9uc1wiO1xuICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci53cml0ZShcIi5naXRpZ25vcmVcIiwgZ2l0aWdub3JlX2ZpbGUgKyBhZGRfdG9fZ2l0aWdub3JlKTtcbiAgICAgIGNvbnNvbGUubG9nKFwiYWRkZWQgLnNtYXJ0LWNvbm5lY3Rpb25zIHRvIC5naXRpZ25vcmVcIik7XG4gICAgfVxuICB9XG5cbiAgLy8gZm9yY2UgcmVmcmVzaCBlbWJlZGRpbmdzIGZpbGUgYnV0IGZpcnN0IHJlbmFtZSBleGlzdGluZyBlbWJlZGRpbmdzIGZpbGUgdG8gLnNtYXJ0LWNvbm5lY3Rpb25zL2VtYmVkZGluZ3MtWVlZWS1NTS1ERC5qc29uXG4gIGFzeW5jIGZvcmNlX3JlZnJlc2hfZW1iZWRkaW5nc19maWxlKCkge1xuICAgIG5ldyBPYnNpZGlhbi5Ob3RpY2UoXCJTbWFydCBDb25uZWN0aW9uczogZW1iZWRkaW5ncyBmaWxlIEZvcmNlIFJlZnJlc2hlZCwgbWFraW5nIG5ldyBjb25uZWN0aW9ucy4uLlwiKTtcbiAgICAvLyBmb3JjZSByZWZyZXNoXG4gICAgYXdhaXQgdGhpcy5zbWFydF92ZWNfbGl0ZS5mb3JjZV9yZWZyZXNoKCk7XG4gICAgLy8gdHJpZ2dlciBtYWtpbmcgbmV3IGNvbm5lY3Rpb25zXG4gICAgYXdhaXQgdGhpcy5nZXRfYWxsX2VtYmVkZGluZ3MoKTtcbiAgICB0aGlzLm91dHB1dF9yZW5kZXJfbG9nKCk7XG4gICAgbmV3IE9ic2lkaWFuLk5vdGljZShcIlNtYXJ0IENvbm5lY3Rpb25zOiBlbWJlZGRpbmdzIGZpbGUgRm9yY2UgUmVmcmVzaGVkLCBuZXcgY29ubmVjdGlvbnMgbWFkZS5cIik7XG4gIH1cblxuICAvLyBnZXQgZW1iZWRkaW5ncyBmb3IgZW1iZWRfaW5wdXRcbiAgYXN5bmMgZ2V0X2ZpbGVfZW1iZWRkaW5ncyhjdXJyX2ZpbGUsIHNhdmU9dHJ1ZSkge1xuICAgIC8vIGxldCBiYXRjaF9wcm9taXNlcyA9IFtdO1xuICAgIGxldCByZXFfYmF0Y2ggPSBbXTtcbiAgICBsZXQgYmxvY2tzID0gW107XG4gICAgLy8gaW5pdGlhdGUgY3Vycl9maWxlX2tleSBmcm9tIG1kNShjdXJyX2ZpbGUucGF0aClcbiAgICBjb25zdCBjdXJyX2ZpbGVfa2V5ID0gbWQ1KGN1cnJfZmlsZS5wYXRoKTtcbiAgICAvLyBpbnRpYXRlIGZpbGVfZmlsZV9lbWJlZF9pbnB1dCBieSByZW1vdmluZyAubWQgYW5kIGNvbnZlcnRpbmcgZmlsZSBwYXRoIHRvIGJyZWFkY3J1bWJzIChcIiA+IFwiKVxuICAgIGxldCBmaWxlX2VtYmVkX2lucHV0ID0gY3Vycl9maWxlLnBhdGgucmVwbGFjZShcIi5tZFwiLCBcIlwiKTtcbiAgICBmaWxlX2VtYmVkX2lucHV0ID0gZmlsZV9lbWJlZF9pbnB1dC5yZXBsYWNlKC9cXC8vZywgXCIgPiBcIik7XG4gICAgLy8gZW1iZWQgb24gZmlsZS5uYW1lL3RpdGxlIG9ubHkgaWYgcGF0aF9vbmx5IHBhdGggbWF0Y2hlciBzcGVjaWZpZWQgaW4gc2V0dGluZ3NcbiAgICBsZXQgcGF0aF9vbmx5ID0gZmFsc2U7XG4gICAgZm9yKGxldCBqID0gMDsgaiA8IHRoaXMucGF0aF9vbmx5Lmxlbmd0aDsgaisrKSB7XG4gICAgICBpZihjdXJyX2ZpbGUucGF0aC5pbmRleE9mKHRoaXMucGF0aF9vbmx5W2pdKSA+IC0xKSB7XG4gICAgICAgIHBhdGhfb25seSA9IHRydWU7XG4gICAgICAgIGNvbnNvbGUubG9nKFwidGl0bGUgb25seSBmaWxlIHdpdGggbWF0Y2hlcjogXCIgKyB0aGlzLnBhdGhfb25seVtqXSk7XG4gICAgICAgIC8vIGJyZWFrIG91dCBvZiBsb29wXG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgICAvLyByZXR1cm4gZWFybHkgaWYgcGF0aF9vbmx5XG4gICAgaWYocGF0aF9vbmx5KSB7XG4gICAgICByZXFfYmF0Y2gucHVzaChbY3Vycl9maWxlX2tleSwgZmlsZV9lbWJlZF9pbnB1dCwge1xuICAgICAgICBtdGltZTogY3Vycl9maWxlLnN0YXQubXRpbWUsXG4gICAgICAgIHBhdGg6IGN1cnJfZmlsZS5wYXRoLFxuICAgICAgfV0pO1xuICAgICAgYXdhaXQgdGhpcy5nZXRfZW1iZWRkaW5nc19iYXRjaChyZXFfYmF0Y2gpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBCRUdJTiBDYW52YXMgZmlsZSB0eXBlIEVtYmVkZGluZ1xuICAgICAqL1xuICAgIGlmKGN1cnJfZmlsZS5leHRlbnNpb24gPT09IFwiY2FudmFzXCIpIHtcbiAgICAgIC8vIGdldCBmaWxlIGNvbnRlbnRzIGFuZCBwYXJzZSBhcyBKU09OXG4gICAgICBjb25zdCBjYW52YXNfY29udGVudHMgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGN1cnJfZmlsZSk7XG4gICAgICBpZigodHlwZW9mIGNhbnZhc19jb250ZW50cyA9PT0gXCJzdHJpbmdcIikgJiYgKGNhbnZhc19jb250ZW50cy5pbmRleE9mKFwibm9kZXNcIikgPiAtMSkpIHtcbiAgICAgICAgY29uc3QgY2FudmFzX2pzb24gPSBKU09OLnBhcnNlKGNhbnZhc19jb250ZW50cyk7XG4gICAgICAgIC8vIGZvciBlYWNoIG9iamVjdCBpbiBub2RlcyBhcnJheVxuICAgICAgICBmb3IobGV0IGogPSAwOyBqIDwgY2FudmFzX2pzb24ubm9kZXMubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgICAvLyBpZiBvYmplY3QgaGFzIHRleHQgcHJvcGVydHlcbiAgICAgICAgICBpZihjYW52YXNfanNvbi5ub2Rlc1tqXS50ZXh0KSB7XG4gICAgICAgICAgICAvLyBhZGQgdG8gZmlsZV9lbWJlZF9pbnB1dFxuICAgICAgICAgICAgZmlsZV9lbWJlZF9pbnB1dCArPSBcIlxcblwiICsgY2FudmFzX2pzb24ubm9kZXNbal0udGV4dDtcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gaWYgb2JqZWN0IGhhcyBmaWxlIHByb3BlcnR5XG4gICAgICAgICAgaWYoY2FudmFzX2pzb24ubm9kZXNbal0uZmlsZSkge1xuICAgICAgICAgICAgLy8gYWRkIHRvIGZpbGVfZW1iZWRfaW5wdXRcbiAgICAgICAgICAgIGZpbGVfZW1iZWRfaW5wdXQgKz0gXCJcXG5MaW5rOiBcIiArIGNhbnZhc19qc29uLm5vZGVzW2pdLmZpbGU7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICAvLyBjb25zb2xlLmxvZyhmaWxlX2VtYmVkX2lucHV0KTtcbiAgICAgIHJlcV9iYXRjaC5wdXNoKFtjdXJyX2ZpbGVfa2V5LCBmaWxlX2VtYmVkX2lucHV0LCB7XG4gICAgICAgIG10aW1lOiBjdXJyX2ZpbGUuc3RhdC5tdGltZSxcbiAgICAgICAgcGF0aDogY3Vycl9maWxlLnBhdGgsXG4gICAgICB9XSk7XG4gICAgICBhd2FpdCB0aGlzLmdldF9lbWJlZGRpbmdzX2JhdGNoKHJlcV9iYXRjaCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIFxuICAgIC8qKlxuICAgICAqIEJFR0lOIEJsb2NrIFwic2VjdGlvblwiIGVtYmVkZGluZ1xuICAgICAqL1xuICAgIC8vIGdldCBmaWxlIGNvbnRlbnRzXG4gICAgY29uc3Qgbm90ZV9jb250ZW50cyA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQoY3Vycl9maWxlKTtcbiAgICBsZXQgcHJvY2Vzc2VkX3NpbmNlX2xhc3Rfc2F2ZSA9IDA7XG4gICAgY29uc3Qgbm90ZV9zZWN0aW9ucyA9IHRoaXMuYmxvY2tfcGFyc2VyKG5vdGVfY29udGVudHMsIGN1cnJfZmlsZS5wYXRoKTtcbiAgICAvLyBjb25zb2xlLmxvZyhub3RlX3NlY3Rpb25zKTtcbiAgICAvLyBpZiBub3RlIGhhcyBtb3JlIHRoYW4gb25lIHNlY3Rpb24gKGlmIG9ubHkgb25lIHRoZW4gaXRzIHNhbWUgYXMgZnVsbC1jb250ZW50KVxuICAgIGlmKG5vdGVfc2VjdGlvbnMubGVuZ3RoID4gMSkge1xuICAgICAgLy8gZm9yIGVhY2ggc2VjdGlvbiBpbiBmaWxlXG4gICAgICAvL2NvbnNvbGUubG9nKFwiU2VjdGlvbnM6IFwiICsgbm90ZV9zZWN0aW9ucy5sZW5ndGgpO1xuICAgICAgZm9yIChsZXQgaiA9IDA7IGogPCBub3RlX3NlY3Rpb25zLmxlbmd0aDsgaisrKSB7XG4gICAgICAgIC8vIGdldCBlbWJlZF9pbnB1dCBmb3IgYmxvY2tcbiAgICAgICAgY29uc3QgYmxvY2tfZW1iZWRfaW5wdXQgPSBub3RlX3NlY3Rpb25zW2pdLnRleHQ7XG4gICAgICAgIC8vIGNvbnNvbGUubG9nKG5vdGVfc2VjdGlvbnNbal0ucGF0aCk7XG4gICAgICAgIC8vIGdldCBibG9jayBrZXkgZnJvbSBibG9jay5wYXRoIChjb250YWlucyBib3RoIGZpbGUucGF0aCBhbmQgaGVhZGVyIHBhdGgpXG4gICAgICAgIGNvbnN0IGJsb2NrX2tleSA9IG1kNShub3RlX3NlY3Rpb25zW2pdLnBhdGgpO1xuICAgICAgICBibG9ja3MucHVzaChibG9ja19rZXkpO1xuICAgICAgICAvLyBza2lwIGlmIGxlbmd0aCBvZiBibG9ja19lbWJlZF9pbnB1dCBzYW1lIGFzIGxlbmd0aCBvZiBlbWJlZGRpbmdzW2Jsb2NrX2tleV0ubWV0YS5zaXplXG4gICAgICAgIC8vIFRPRE8gY29uc2lkZXIgcm91bmRpbmcgdG8gbmVhcmVzdCAxMCBvciAxMDAgZm9yIGZ1enp5IG1hdGNoaW5nXG4gICAgICAgIGlmICh0aGlzLnNtYXJ0X3ZlY19saXRlLmdldF9zaXplKGJsb2NrX2tleSkgPT09IGJsb2NrX2VtYmVkX2lucHV0Lmxlbmd0aCkge1xuICAgICAgICAgIC8vIGxvZyBza2lwcGluZyBmaWxlXG4gICAgICAgICAgLy8gY29uc29sZS5sb2coXCJza2lwcGluZyBibG9jayAobGVuKVwiKTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICAvLyBhZGQgaGFzaCB0byBibG9ja3MgdG8gcHJldmVudCBlbXB0eSBibG9ja3MgdHJpZ2dlcmluZyBmdWxsLWZpbGUgZW1iZWRkaW5nXG4gICAgICAgIC8vIHNraXAgaWYgZW1iZWRkaW5ncyBrZXkgYWxyZWFkeSBleGlzdHMgYW5kIGJsb2NrIG10aW1lIGlzIGdyZWF0ZXIgdGhhbiBvciBlcXVhbCB0byBmaWxlIG10aW1lXG4gICAgICAgIGlmKHRoaXMuc21hcnRfdmVjX2xpdGUubXRpbWVfaXNfY3VycmVudChibG9ja19rZXksIGN1cnJfZmlsZS5zdGF0Lm10aW1lKSkge1xuICAgICAgICAgIC8vIGxvZyBza2lwcGluZyBmaWxlXG4gICAgICAgICAgLy8gY29uc29sZS5sb2coXCJza2lwcGluZyBibG9jayAobXRpbWUpXCIpO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIC8vIHNraXAgaWYgaGFzaCBpcyBwcmVzZW50IGluIGVtYmVkZGluZ3MgYW5kIGhhc2ggb2YgYmxvY2tfZW1iZWRfaW5wdXQgaXMgZXF1YWwgdG8gaGFzaCBpbiBlbWJlZGRpbmdzXG4gICAgICAgIGNvbnN0IGJsb2NrX2hhc2ggPSBtZDUoYmxvY2tfZW1iZWRfaW5wdXQudHJpbSgpKTtcbiAgICAgICAgaWYodGhpcy5zbWFydF92ZWNfbGl0ZS5nZXRfaGFzaChibG9ja19rZXkpID09PSBibG9ja19oYXNoKSB7XG4gICAgICAgICAgLy8gbG9nIHNraXBwaW5nIGZpbGVcbiAgICAgICAgICAvLyBjb25zb2xlLmxvZyhcInNraXBwaW5nIGJsb2NrIChoYXNoKVwiKTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGNyZWF0ZSByZXFfYmF0Y2ggZm9yIGJhdGNoaW5nIHJlcXVlc3RzXG4gICAgICAgIHJlcV9iYXRjaC5wdXNoKFtibG9ja19rZXksIGJsb2NrX2VtYmVkX2lucHV0LCB7XG4gICAgICAgICAgLy8gb2xkbXRpbWU6IGN1cnJfZmlsZS5zdGF0Lm10aW1lLCBcbiAgICAgICAgICAvLyBnZXQgY3VycmVudCBkYXRldGltZSBhcyB1bml4IHRpbWVzdGFtcFxuICAgICAgICAgIG10aW1lOiBEYXRlLm5vdygpLFxuICAgICAgICAgIGhhc2g6IGJsb2NrX2hhc2gsIFxuICAgICAgICAgIHBhcmVudDogY3Vycl9maWxlX2tleSxcbiAgICAgICAgICBwYXRoOiBub3RlX3NlY3Rpb25zW2pdLnBhdGgsXG4gICAgICAgICAgc2l6ZTogYmxvY2tfZW1iZWRfaW5wdXQubGVuZ3RoLFxuICAgICAgICB9XSk7XG4gICAgICAgIGlmKHJlcV9iYXRjaC5sZW5ndGggPiA5KSB7XG4gICAgICAgICAgLy8gYWRkIGJhdGNoIHRvIGJhdGNoX3Byb21pc2VzXG4gICAgICAgICAgYXdhaXQgdGhpcy5nZXRfZW1iZWRkaW5nc19iYXRjaChyZXFfYmF0Y2gpO1xuICAgICAgICAgIHByb2Nlc3NlZF9zaW5jZV9sYXN0X3NhdmUgKz0gcmVxX2JhdGNoLmxlbmd0aDtcbiAgICAgICAgICAvLyBsb2cgZW1iZWRkaW5nXG4gICAgICAgICAgLy8gY29uc29sZS5sb2coXCJlbWJlZGRpbmc6IFwiICsgY3Vycl9maWxlLnBhdGgpO1xuICAgICAgICAgIGlmIChwcm9jZXNzZWRfc2luY2VfbGFzdF9zYXZlID49IDMwKSB7XG4gICAgICAgICAgICAvLyB3cml0ZSBlbWJlZGRpbmdzIEpTT04gdG8gZmlsZVxuICAgICAgICAgICAgYXdhaXQgdGhpcy5zYXZlX2VtYmVkZGluZ3NfdG9fZmlsZSgpO1xuICAgICAgICAgICAgLy8gcmVzZXQgcHJvY2Vzc2VkX3NpbmNlX2xhc3Rfc2F2ZVxuICAgICAgICAgICAgcHJvY2Vzc2VkX3NpbmNlX2xhc3Rfc2F2ZSA9IDA7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIHJlc2V0IHJlcV9iYXRjaFxuICAgICAgICAgIHJlcV9iYXRjaCA9IFtdO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIC8vIGlmIHJlcV9iYXRjaCBpcyBub3QgZW1wdHlcbiAgICBpZihyZXFfYmF0Y2gubGVuZ3RoID4gMCkge1xuICAgICAgLy8gcHJvY2VzcyByZW1haW5pbmcgcmVxX2JhdGNoXG4gICAgICBhd2FpdCB0aGlzLmdldF9lbWJlZGRpbmdzX2JhdGNoKHJlcV9iYXRjaCk7XG4gICAgICByZXFfYmF0Y2ggPSBbXTtcbiAgICAgIHByb2Nlc3NlZF9zaW5jZV9sYXN0X3NhdmUgKz0gcmVxX2JhdGNoLmxlbmd0aDtcbiAgICB9XG4gICAgXG4gICAgLyoqXG4gICAgICogQkVHSU4gRmlsZSBcImZ1bGwgbm90ZVwiIGVtYmVkZGluZ1xuICAgICAqL1xuXG4gICAgLy8gaWYgZmlsZSBsZW5ndGggaXMgbGVzcyB0aGFuIH44MDAwIHRva2VucyB1c2UgZnVsbCBmaWxlIGNvbnRlbnRzXG4gICAgLy8gZWxzZSBpZiBmaWxlIGxlbmd0aCBpcyBncmVhdGVyIHRoYW4gODAwMCB0b2tlbnMgYnVpbGQgZmlsZV9lbWJlZF9pbnB1dCBmcm9tIGZpbGUgaGVhZGluZ3NcbiAgICBmaWxlX2VtYmVkX2lucHV0ICs9IGA6XFxuYDtcbiAgICAvKipcbiAgICAgKiBUT0RPOiBpbXByb3ZlL3JlZmFjdG9yIHRoZSBmb2xsb3dpbmcgXCJsYXJnZSBmaWxlIHJlZHVjZSB0byBoZWFkaW5nc1wiIGxvZ2ljXG4gICAgICovXG4gICAgaWYobm90ZV9jb250ZW50cy5sZW5ndGggPCBNQVhfRU1CRURfU1RSSU5HX0xFTkdUSCkge1xuICAgICAgZmlsZV9lbWJlZF9pbnB1dCArPSBub3RlX2NvbnRlbnRzXG4gICAgfWVsc2V7IFxuICAgICAgY29uc3Qgbm90ZV9tZXRhX2NhY2hlID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoY3Vycl9maWxlKTtcbiAgICAgIC8vIGZvciBlYWNoIGhlYWRpbmcgaW4gZmlsZVxuICAgICAgaWYodHlwZW9mIG5vdGVfbWV0YV9jYWNoZS5oZWFkaW5ncyA9PT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICAvLyBjb25zb2xlLmxvZyhcIm5vIGhlYWRpbmdzIGZvdW5kLCB1c2luZyBmaXJzdCBjaHVuayBvZiBmaWxlIGluc3RlYWRcIik7XG4gICAgICAgIGZpbGVfZW1iZWRfaW5wdXQgKz0gbm90ZV9jb250ZW50cy5zdWJzdHJpbmcoMCwgTUFYX0VNQkVEX1NUUklOR19MRU5HVEgpO1xuICAgICAgfWVsc2V7XG4gICAgICAgIGxldCBub3RlX2hlYWRpbmdzID0gXCJcIjtcbiAgICAgICAgZm9yIChsZXQgaiA9IDA7IGogPCBub3RlX21ldGFfY2FjaGUuaGVhZGluZ3MubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgICAvLyBnZXQgaGVhZGluZyBsZXZlbFxuICAgICAgICAgIGNvbnN0IGhlYWRpbmdfbGV2ZWwgPSBub3RlX21ldGFfY2FjaGUuaGVhZGluZ3Nbal0ubGV2ZWw7XG4gICAgICAgICAgLy8gZ2V0IGhlYWRpbmcgdGV4dFxuICAgICAgICAgIGNvbnN0IGhlYWRpbmdfdGV4dCA9IG5vdGVfbWV0YV9jYWNoZS5oZWFkaW5nc1tqXS5oZWFkaW5nO1xuICAgICAgICAgIC8vIGJ1aWxkIG1hcmtkb3duIGhlYWRpbmdcbiAgICAgICAgICBsZXQgbWRfaGVhZGluZyA9IFwiXCI7XG4gICAgICAgICAgZm9yIChsZXQgayA9IDA7IGsgPCBoZWFkaW5nX2xldmVsOyBrKyspIHtcbiAgICAgICAgICAgIG1kX2hlYWRpbmcgKz0gXCIjXCI7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIGFkZCBoZWFkaW5nIHRvIG5vdGVfaGVhZGluZ3NcbiAgICAgICAgICBub3RlX2hlYWRpbmdzICs9IGAke21kX2hlYWRpbmd9ICR7aGVhZGluZ190ZXh0fVxcbmA7XG4gICAgICAgIH1cbiAgICAgICAgLy9jb25zb2xlLmxvZyhub3RlX2hlYWRpbmdzKTtcbiAgICAgICAgZmlsZV9lbWJlZF9pbnB1dCArPSBub3RlX2hlYWRpbmdzXG4gICAgICAgIGlmKGZpbGVfZW1iZWRfaW5wdXQubGVuZ3RoID4gTUFYX0VNQkVEX1NUUklOR19MRU5HVEgpIHtcbiAgICAgICAgICBmaWxlX2VtYmVkX2lucHV0ID0gZmlsZV9lbWJlZF9pbnB1dC5zdWJzdHJpbmcoMCwgTUFYX0VNQkVEX1NUUklOR19MRU5HVEgpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIC8vIHNraXAgZW1iZWRkaW5nIGZ1bGwgZmlsZSBpZiBibG9ja3MgaXMgbm90IGVtcHR5IGFuZCBhbGwgaGFzaGVzIGFyZSBwcmVzZW50IGluIGVtYmVkZGluZ3NcbiAgICAvLyBiZXR0ZXIgdGhhbiBoYXNoaW5nIGZpbGVfZW1iZWRfaW5wdXQgYmVjYXVzZSBtb3JlIHJlc2lsaWVudCB0byBpbmNvbnNlcXVlbnRpYWwgY2hhbmdlcyAod2hpdGVzcGFjZSBiZXR3ZWVuIGhlYWRpbmdzKVxuICAgIGNvbnN0IGZpbGVfaGFzaCA9IG1kNShmaWxlX2VtYmVkX2lucHV0LnRyaW0oKSk7XG4gICAgY29uc3QgZXhpc3RpbmdfaGFzaCA9IHRoaXMuc21hcnRfdmVjX2xpdGUuZ2V0X2hhc2goY3Vycl9maWxlX2tleSk7XG4gICAgaWYoZXhpc3RpbmdfaGFzaCAmJiAoZmlsZV9oYXNoID09PSBleGlzdGluZ19oYXNoKSkge1xuICAgICAgLy8gY29uc29sZS5sb2coXCJza2lwcGluZyBmaWxlIChoYXNoKTogXCIgKyBjdXJyX2ZpbGUucGF0aCk7XG4gICAgICB0aGlzLnVwZGF0ZV9yZW5kZXJfbG9nKGJsb2NrcywgZmlsZV9lbWJlZF9pbnB1dCk7XG4gICAgICByZXR1cm47XG4gICAgfTtcblxuICAgIC8vIGlmIG5vdCBhbHJlYWR5IHNraXBwaW5nIGFuZCBibG9ja3MgYXJlIHByZXNlbnRcbiAgICBjb25zdCBleGlzdGluZ19ibG9ja3MgPSB0aGlzLnNtYXJ0X3ZlY19saXRlLmdldF9jaGlsZHJlbihjdXJyX2ZpbGVfa2V5KTtcbiAgICBsZXQgZXhpc3RpbmdfaGFzX2FsbF9ibG9ja3MgPSB0cnVlO1xuICAgIGlmKGV4aXN0aW5nX2Jsb2NrcyAmJiBBcnJheS5pc0FycmF5KGV4aXN0aW5nX2Jsb2NrcykgJiYgKGJsb2Nrcy5sZW5ndGggPiAwKSkge1xuICAgICAgLy8gaWYgYWxsIGJsb2NrcyBhcmUgaW4gZXhpc3RpbmdfYmxvY2tzIHRoZW4gc2tpcCAoYWxsb3dzIGRlbGV0aW9uIG9mIHNtYWxsIGJsb2NrcyB3aXRob3V0IHRyaWdnZXJpbmcgZnVsbCBmaWxlIGVtYmVkZGluZylcbiAgICAgIGZvciAobGV0IGogPSAwOyBqIDwgYmxvY2tzLmxlbmd0aDsgaisrKSB7XG4gICAgICAgIGlmKGV4aXN0aW5nX2Jsb2Nrcy5pbmRleE9mKGJsb2Nrc1tqXSkgPT09IC0xKSB7XG4gICAgICAgICAgZXhpc3RpbmdfaGFzX2FsbF9ibG9ja3MgPSBmYWxzZTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICAvLyBpZiBleGlzdGluZyBoYXMgYWxsIGJsb2NrcyB0aGVuIGNoZWNrIGZpbGUgc2l6ZSBmb3IgZGVsdGFcbiAgICBpZihleGlzdGluZ19oYXNfYWxsX2Jsb2Nrcyl7XG4gICAgICAvLyBnZXQgY3VycmVudCBub3RlIGZpbGUgc2l6ZVxuICAgICAgY29uc3QgY3Vycl9maWxlX3NpemUgPSBjdXJyX2ZpbGUuc3RhdC5zaXplO1xuICAgICAgLy8gZ2V0IGZpbGUgc2l6ZSBmcm9tIGVtYmVkZGluZ3NcbiAgICAgIGNvbnN0IHByZXZfZmlsZV9zaXplID0gdGhpcy5zbWFydF92ZWNfbGl0ZS5nZXRfc2l6ZShjdXJyX2ZpbGVfa2V5KTtcbiAgICAgIGlmIChwcmV2X2ZpbGVfc2l6ZSkge1xuICAgICAgICAvLyBpZiBjdXJyIGZpbGUgc2l6ZSBpcyBsZXNzIHRoYW4gMTAlIGRpZmZlcmVudCBmcm9tIHByZXYgZmlsZSBzaXplXG4gICAgICAgIGNvbnN0IGZpbGVfZGVsdGFfcGN0ID0gTWF0aC5yb3VuZCgoTWF0aC5hYnMoY3Vycl9maWxlX3NpemUgLSBwcmV2X2ZpbGVfc2l6ZSkgLyBjdXJyX2ZpbGVfc2l6ZSkgKiAxMDApO1xuICAgICAgICBpZihmaWxlX2RlbHRhX3BjdCA8IDEwKSB7XG4gICAgICAgICAgLy8gc2tpcCBlbWJlZGRpbmdcbiAgICAgICAgICAvLyBjb25zb2xlLmxvZyhcInNraXBwaW5nIGZpbGUgKHNpemUpIFwiICsgY3Vycl9maWxlLnBhdGgpO1xuICAgICAgICAgIHRoaXMucmVuZGVyX2xvZy5za2lwcGVkX2xvd19kZWx0YVtjdXJyX2ZpbGUubmFtZV0gPSBmaWxlX2RlbHRhX3BjdCArIFwiJVwiO1xuICAgICAgICAgIHRoaXMudXBkYXRlX3JlbmRlcl9sb2coYmxvY2tzLCBmaWxlX2VtYmVkX2lucHV0KTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgbGV0IG1ldGEgPSB7XG4gICAgICBtdGltZTogY3Vycl9maWxlLnN0YXQubXRpbWUsXG4gICAgICBoYXNoOiBmaWxlX2hhc2gsXG4gICAgICBwYXRoOiBjdXJyX2ZpbGUucGF0aCxcbiAgICAgIHNpemU6IGN1cnJfZmlsZS5zdGF0LnNpemUsXG4gICAgICBjaGlsZHJlbjogYmxvY2tzLFxuICAgIH07XG4gICAgLy8gYmF0Y2hfcHJvbWlzZXMucHVzaCh0aGlzLmdldF9lbWJlZGRpbmdzKGN1cnJfZmlsZV9rZXksIGZpbGVfZW1iZWRfaW5wdXQsIG1ldGEpKTtcbiAgICByZXFfYmF0Y2gucHVzaChbY3Vycl9maWxlX2tleSwgZmlsZV9lbWJlZF9pbnB1dCwgbWV0YV0pO1xuICAgIC8vIHNlbmQgYmF0Y2ggcmVxdWVzdFxuICAgIGF3YWl0IHRoaXMuZ2V0X2VtYmVkZGluZ3NfYmF0Y2gocmVxX2JhdGNoKTtcblxuICAgIC8vIGxvZyBlbWJlZGRpbmdcbiAgICAvLyBjb25zb2xlLmxvZyhcImVtYmVkZGluZzogXCIgKyBjdXJyX2ZpbGUucGF0aCk7XG4gICAgaWYgKHNhdmUpIHtcbiAgICAgIC8vIHdyaXRlIGVtYmVkZGluZ3MgSlNPTiB0byBmaWxlXG4gICAgICBhd2FpdCB0aGlzLnNhdmVfZW1iZWRkaW5nc190b19maWxlKCk7XG4gICAgfVxuXG4gIH1cblxuICB1cGRhdGVfcmVuZGVyX2xvZyhibG9ja3MsIGZpbGVfZW1iZWRfaW5wdXQpIHtcbiAgICBpZiAoYmxvY2tzLmxlbmd0aCA+IDApIHtcbiAgICAgIC8vIG11bHRpcGx5IGJ5IDIgYmVjYXVzZSBpbXBsaWVzIHdlIHNhdmVkIHRva2VuIHNwZW5kaW5nIG9uIGJsb2NrcyhzZWN0aW9ucyksIHRvb1xuICAgICAgdGhpcy5yZW5kZXJfbG9nLnRva2Vuc19zYXZlZF9ieV9jYWNoZSArPSBmaWxlX2VtYmVkX2lucHV0Lmxlbmd0aCAvIDI7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIGNhbGMgdG9rZW5zIHNhdmVkIGJ5IGNhY2hlOiBkaXZpZGUgYnkgNCBmb3IgdG9rZW4gZXN0aW1hdGVcbiAgICAgIHRoaXMucmVuZGVyX2xvZy50b2tlbnNfc2F2ZWRfYnlfY2FjaGUgKz0gZmlsZV9lbWJlZF9pbnB1dC5sZW5ndGggLyA0O1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGdldF9lbWJlZGRpbmdzX2JhdGNoKHJlcV9iYXRjaCkge1xuICAgIGNvbnNvbGUubG9nKFwiZ2V0X2VtYmVkZGluZ3NfYmF0Y2hcIik7XG4gICAgLy8gaWYgcmVxX2JhdGNoIGlzIGVtcHR5IHRoZW4gcmV0dXJuXG4gICAgaWYocmVxX2JhdGNoLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICAgIC8vIGNyZWF0ZSBhcnJhcnkgb2YgZW1iZWRfaW5wdXRzIGZyb20gcmVxX2JhdGNoW2ldWzFdXG4gICAgY29uc3QgZW1iZWRfaW5wdXRzID0gcmVxX2JhdGNoLm1hcCgocmVxKSA9PiByZXFbMV0pO1xuICAgIC8vIHJlcXVlc3QgZW1iZWRkaW5ncyBmcm9tIGVtYmVkX2lucHV0c1xuICAgIGNvbnN0IHJlcXVlc3RSZXN1bHRzID0gYXdhaXQgdGhpcy5yZXF1ZXN0X2VtYmVkZGluZ19mcm9tX2lucHV0KGVtYmVkX2lucHV0cyk7XG4gICAgLy8gaWYgcmVxdWVzdFJlc3VsdHMgaXMgbnVsbCB0aGVuIHJldHVyblxuICAgIGlmKCFyZXF1ZXN0UmVzdWx0cykge1xuICAgICAgY29uc29sZS5sb2coXCJmYWlsZWQgZW1iZWRkaW5nIGJhdGNoXCIpO1xuICAgICAgLy8gbG9nIGZhaWxlZCBmaWxlIG5hbWVzIHRvIHJlbmRlcl9sb2dcbiAgICAgIHRoaXMucmVuZGVyX2xvZy5mYWlsZWRfZW1iZWRkaW5ncyA9IFsuLi50aGlzLnJlbmRlcl9sb2cuZmFpbGVkX2VtYmVkZGluZ3MsIC4uLnJlcV9iYXRjaC5tYXAoKHJlcSkgPT4gcmVxWzJdLnBhdGgpXTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgLy8gaWYgcmVxdWVzdFJlc3VsdHMgaXMgbm90IG51bGxcbiAgICBpZihyZXF1ZXN0UmVzdWx0cyl7XG4gICAgICB0aGlzLmhhc19uZXdfZW1iZWRkaW5ncyA9IHRydWU7XG4gICAgICAvLyBhZGQgZW1iZWRkaW5nIGtleSB0byByZW5kZXJfbG9nXG4gICAgICBpZih0aGlzLnNldHRpbmdzLmxvZ19yZW5kZXIpe1xuICAgICAgICBpZih0aGlzLnNldHRpbmdzLmxvZ19yZW5kZXJfZmlsZXMpe1xuICAgICAgICAgIHRoaXMucmVuZGVyX2xvZy5maWxlcyA9IFsuLi50aGlzLnJlbmRlcl9sb2cuZmlsZXMsIC4uLnJlcV9iYXRjaC5tYXAoKHJlcSkgPT4gcmVxWzJdLnBhdGgpXTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnJlbmRlcl9sb2cubmV3X2VtYmVkZGluZ3MgKz0gcmVxX2JhdGNoLmxlbmd0aDtcbiAgICAgICAgLy8gYWRkIHRva2VuIHVzYWdlIHRvIHJlbmRlcl9sb2dcbiAgICAgICAgdGhpcy5yZW5kZXJfbG9nLnRva2VuX3VzYWdlICs9IHJlcXVlc3RSZXN1bHRzLnVzYWdlLnRvdGFsX3Rva2VucztcbiAgICAgIH1cbiAgICAgIC8vIGNvbnNvbGUubG9nKHJlcXVlc3RSZXN1bHRzLmRhdGEubGVuZ3RoKTtcbiAgICAgIC8vIGxvb3AgdGhyb3VnaCByZXF1ZXN0UmVzdWx0cy5kYXRhXG4gICAgICBmb3IobGV0IGkgPSAwOyBpIDwgcmVxdWVzdFJlc3VsdHMuZGF0YS5sZW5ndGg7IGkrKykge1xuICAgICAgICBjb25zdCB2ZWMgPSByZXF1ZXN0UmVzdWx0cy5kYXRhW2ldLmVtYmVkZGluZztcbiAgICAgICAgY29uc3QgaW5kZXggPSByZXF1ZXN0UmVzdWx0cy5kYXRhW2ldLmluZGV4O1xuICAgICAgICBpZih2ZWMpIHtcbiAgICAgICAgICBjb25zdCBrZXkgPSByZXFfYmF0Y2hbaW5kZXhdWzBdO1xuICAgICAgICAgIGNvbnN0IG1ldGEgPSByZXFfYmF0Y2hbaW5kZXhdWzJdO1xuICAgICAgICAgIHRoaXMuc21hcnRfdmVjX2xpdGUuc2F2ZV9lbWJlZGRpbmcoa2V5LCB2ZWMsIG1ldGEpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgcmVxdWVzdF9lbWJlZGRpbmdfZnJvbV9pbnB1dChlbWJlZF9pbnB1dCwgcmV0cmllcyA9IDApIHtcbiAgICAvLyAoRk9SIFRFU1RJTkcpIHRlc3QgZmFpbCBwcm9jZXNzIGJ5IGZvcmNpbmcgZmFpbFxuICAgIC8vIHJldHVybiBudWxsO1xuICAgIC8vIGNoZWNrIGlmIGVtYmVkX2lucHV0IGlzIGEgc3RyaW5nXG4gICAgLy8gaWYodHlwZW9mIGVtYmVkX2lucHV0ICE9PSBcInN0cmluZ1wiKSB7XG4gICAgLy8gICBjb25zb2xlLmxvZyhcImVtYmVkX2lucHV0IGlzIG5vdCBhIHN0cmluZ1wiKTtcbiAgICAvLyAgIHJldHVybiBudWxsO1xuICAgIC8vIH1cbiAgICAvLyBjaGVjayBpZiBlbWJlZF9pbnB1dCBpcyBlbXB0eVxuICAgIGlmKGVtYmVkX2lucHV0Lmxlbmd0aCA9PT0gMCkge1xuICAgICAgY29uc29sZS5sb2coXCJlbWJlZF9pbnB1dCBpcyBlbXB0eVwiKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICBjb25zdCB1c2VkUGFyYW1zID0ge1xuICAgICAgbW9kZWw6IFwidGV4dC1lbWJlZGRpbmctYWRhLTAwMlwiLFxuICAgICAgaW5wdXQ6IGVtYmVkX2lucHV0LFxuICAgIH07XG4gICAgLy8gY29uc29sZS5sb2codGhpcy5zZXR0aW5ncy5hcGlfa2V5KTtcbiAgICBjb25zdCByZXFQYXJhbXMgPSB7XG4gICAgICB1cmw6IGAke3RoaXMuc2V0dGluZ3MuYXBpX2VuZHBvaW50fS92MS9lbWJlZGRpbmdzYCxcbiAgICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh1c2VkUGFyYW1zKSxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gICAgICAgIFwiQXV0aG9yaXphdGlvblwiOiBgQmVhcmVyICR7dGhpcy5zZXR0aW5ncy5hcGlfa2V5fWBcbiAgICAgIH1cbiAgICB9O1xuICAgIGxldCByZXNwO1xuICAgIHRyeSB7XG4gICAgICByZXNwID0gYXdhaXQgKDAsIE9ic2lkaWFuLnJlcXVlc3QpKHJlcVBhcmFtcylcbiAgICAgIHJldHVybiBKU09OLnBhcnNlKHJlc3ApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAvLyByZXRyeSByZXF1ZXN0IGlmIGVycm9yIGlzIDQyOVxuICAgICAgaWYoKGVycm9yLnN0YXR1cyA9PT0gNDI5KSAmJiAocmV0cmllcyA8IDMpKSB7XG4gICAgICAgIHJldHJpZXMrKztcbiAgICAgICAgLy8gZXhwb25lbnRpYWwgYmFja29mZlxuICAgICAgICBjb25zdCBiYWNrb2ZmID0gTWF0aC5wb3cocmV0cmllcywgMik7XG4gICAgICAgIGNvbnNvbGUubG9nKGByZXRyeWluZyByZXF1ZXN0ICg0MjkpIGluICR7YmFja29mZn0gc2Vjb25kcy4uLmApO1xuICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyID0+IHNldFRpbWVvdXQociwgMTAwMCAqIGJhY2tvZmYpKTtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMucmVxdWVzdF9lbWJlZGRpbmdfZnJvbV9pbnB1dChlbWJlZF9pbnB1dCwgcmV0cmllcyk7XG4gICAgICB9XG4gICAgICAvLyBsb2cgZnVsbCBlcnJvciB0byBjb25zb2xlXG4gICAgICBjb25zb2xlLmxvZyhyZXNwKTtcbiAgICAgIC8vIGNvbnNvbGUubG9nKFwiZmlyc3QgbGluZSBvZiBlbWJlZDogXCIgKyBlbWJlZF9pbnB1dC5zdWJzdHJpbmcoMCwgZW1iZWRfaW5wdXQuaW5kZXhPZihcIlxcblwiKSkpO1xuICAgICAgLy8gY29uc29sZS5sb2coXCJlbWJlZCBpbnB1dCBsZW5ndGg6IFwiKyBlbWJlZF9pbnB1dC5sZW5ndGgpO1xuICAgICAgLy8gaWYoQXJyYXkuaXNBcnJheShlbWJlZF9pbnB1dCkpIHtcbiAgICAgIC8vICAgY29uc29sZS5sb2coZW1iZWRfaW5wdXQubWFwKChpbnB1dCkgPT4gaW5wdXQubGVuZ3RoKSk7XG4gICAgICAvLyB9XG4gICAgICAvLyBjb25zb2xlLmxvZyhcImVycm9uZW91cyBlbWJlZCBpbnB1dDogXCIgKyBlbWJlZF9pbnB1dCk7XG4gICAgICBjb25zb2xlLmxvZyhlcnJvcik7XG4gICAgICAvLyBjb25zb2xlLmxvZyh1c2VkUGFyYW1zKTtcbiAgICAgIC8vIGNvbnNvbGUubG9nKHVzZWRQYXJhbXMuaW5wdXQubGVuZ3RoKTtcbiAgICAgIHJldHVybiBudWxsOyBcbiAgICB9XG4gIH1cbiAgYXN5bmMgdGVzdF9hcGlfa2V5KCkge1xuICAgIGNvbnN0IGVtYmVkX2lucHV0ID0gXCJUaGlzIGlzIGEgdGVzdCBvZiB0aGUgT3BlbkFJIEFQSS5cIjtcbiAgICBjb25zdCByZXNwID0gYXdhaXQgdGhpcy5yZXF1ZXN0X2VtYmVkZGluZ19mcm9tX2lucHV0KGVtYmVkX2lucHV0KTtcbiAgICBpZihyZXNwICYmIHJlc3AudXNhZ2UpIHtcbiAgICAgIGNvbnNvbGUubG9nKFwiQVBJIGtleSBpcyB2YWxpZFwiKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1lbHNle1xuICAgICAgY29uc29sZS5sb2coXCJBUEkga2V5IGlzIGludmFsaWRcIik7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG5cblxuICBvdXRwdXRfcmVuZGVyX2xvZygpIHtcbiAgICAvLyBpZiBzZXR0aW5ncy5sb2dfcmVuZGVyIGlzIHRydWVcbiAgICBpZih0aGlzLnNldHRpbmdzLmxvZ19yZW5kZXIpIHtcbiAgICAgIGlmICh0aGlzLnJlbmRlcl9sb2cubmV3X2VtYmVkZGluZ3MgPT09IDApIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfWVsc2V7XG4gICAgICAgIC8vIHByZXR0eSBwcmludCB0aGlzLnJlbmRlcl9sb2cgdG8gY29uc29sZVxuICAgICAgICBjb25zb2xlLmxvZyhKU09OLnN0cmluZ2lmeSh0aGlzLnJlbmRlcl9sb2csIG51bGwsIDIpKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBjbGVhciByZW5kZXJfbG9nXG4gICAgdGhpcy5yZW5kZXJfbG9nID0ge307XG4gICAgdGhpcy5yZW5kZXJfbG9nLmRlbGV0ZWRfZW1iZWRkaW5ncyA9IDA7XG4gICAgdGhpcy5yZW5kZXJfbG9nLmV4Y2x1c2lvbnNfbG9ncyA9IHt9O1xuICAgIHRoaXMucmVuZGVyX2xvZy5mYWlsZWRfZW1iZWRkaW5ncyA9IFtdO1xuICAgIHRoaXMucmVuZGVyX2xvZy5maWxlcyA9IFtdO1xuICAgIHRoaXMucmVuZGVyX2xvZy5uZXdfZW1iZWRkaW5ncyA9IDA7XG4gICAgdGhpcy5yZW5kZXJfbG9nLnNraXBwZWRfbG93X2RlbHRhID0ge307XG4gICAgdGhpcy5yZW5kZXJfbG9nLnRva2VuX3VzYWdlID0gMDtcbiAgICB0aGlzLnJlbmRlcl9sb2cudG9rZW5zX3NhdmVkX2J5X2NhY2hlID0gMDtcbiAgfVxuXG4gIC8vIGZpbmQgY29ubmVjdGlvbnMgYnkgbW9zdCBzaW1pbGFyIHRvIGN1cnJlbnQgbm90ZSBieSBjb3NpbmUgc2ltaWxhcml0eVxuICBhc3luYyBmaW5kX25vdGVfY29ubmVjdGlvbnMoY3VycmVudF9ub3RlPW51bGwpIHtcbiAgICAvLyBtZDUgb2YgY3VycmVudCBub3RlIHBhdGhcbiAgICBjb25zdCBjdXJyX2tleSA9IG1kNShjdXJyZW50X25vdGUucGF0aCk7XG4gICAgLy8gaWYgaW4gdGhpcy5uZWFyZXN0X2NhY2hlIHRoZW4gc2V0IHRvIG5lYXJlc3RcbiAgICAvLyBlbHNlIGdldCBuZWFyZXN0XG4gICAgbGV0IG5lYXJlc3QgPSBbXTtcbiAgICBpZih0aGlzLm5lYXJlc3RfY2FjaGVbY3Vycl9rZXldKSB7XG4gICAgICBuZWFyZXN0ID0gdGhpcy5uZWFyZXN0X2NhY2hlW2N1cnJfa2V5XTtcbiAgICAgIC8vIGNvbnNvbGUubG9nKFwibmVhcmVzdCBmcm9tIGNhY2hlXCIpO1xuICAgIH1lbHNle1xuICAgICAgLy8gc2tpcCBmaWxlcyB3aGVyZSBwYXRoIGNvbnRhaW5zIGFueSBleGNsdXNpb25zXG4gICAgICBmb3IobGV0IGogPSAwOyBqIDwgdGhpcy5maWxlX2V4Y2x1c2lvbnMubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgaWYoY3VycmVudF9ub3RlLnBhdGguaW5kZXhPZih0aGlzLmZpbGVfZXhjbHVzaW9uc1tqXSkgPiAtMSkge1xuICAgICAgICAgIHRoaXMubG9nX2V4Y2x1c2lvbih0aGlzLmZpbGVfZXhjbHVzaW9uc1tqXSk7XG4gICAgICAgICAgLy8gYnJlYWsgb3V0IG9mIGxvb3AgYW5kIGZpbmlzaCBoZXJlXG4gICAgICAgICAgcmV0dXJuIFwiZXhjbHVkZWRcIjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgLy8gZ2V0IGFsbCBlbWJlZGRpbmdzXG4gICAgICAvLyBhd2FpdCB0aGlzLmdldF9hbGxfZW1iZWRkaW5ncygpO1xuICAgICAgLy8gd3JhcCBnZXQgYWxsIGluIHNldFRpbWVvdXQgdG8gYWxsb3cgZm9yIFVJIHRvIHVwZGF0ZVxuICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIHRoaXMuZ2V0X2FsbF9lbWJlZGRpbmdzKClcbiAgICAgIH0sIDMwMDApO1xuICAgICAgLy8gZ2V0IGZyb20gY2FjaGUgaWYgbXRpbWUgaXMgc2FtZSBhbmQgdmFsdWVzIGFyZSBub3QgZW1wdHlcbiAgICAgIGlmKHRoaXMuc21hcnRfdmVjX2xpdGUubXRpbWVfaXNfY3VycmVudChjdXJyX2tleSwgY3VycmVudF9ub3RlLnN0YXQubXRpbWUpKSB7XG4gICAgICAgIC8vIHNraXBwaW5nIGdldCBmaWxlIGVtYmVkZGluZ3MgYmVjYXVzZSBub3RoaW5nIGhhcyBjaGFuZ2VkXG4gICAgICAgIC8vIGNvbnNvbGUubG9nKFwiZmluZF9ub3RlX2Nvbm5lY3Rpb25zIC0gc2tpcHBpbmcgZmlsZSAobXRpbWUpXCIpO1xuICAgICAgfWVsc2V7XG4gICAgICAgIC8vIGdldCBmaWxlIGVtYmVkZGluZ3NcbiAgICAgICAgYXdhaXQgdGhpcy5nZXRfZmlsZV9lbWJlZGRpbmdzKGN1cnJlbnRfbm90ZSk7XG4gICAgICB9XG4gICAgICAvLyBnZXQgY3VycmVudCBub3RlIGVtYmVkZGluZyB2ZWN0b3JcbiAgICAgIGNvbnN0IHZlYyA9IHRoaXMuc21hcnRfdmVjX2xpdGUuZ2V0X3ZlYyhjdXJyX2tleSk7XG4gICAgICBpZighdmVjKSB7XG4gICAgICAgIHJldHVybiBcIkVycm9yIGdldHRpbmcgZW1iZWRkaW5ncyBmb3I6IFwiK2N1cnJlbnRfbm90ZS5wYXRoO1xuICAgICAgfVxuICAgICAgXG4gICAgICAvLyBjb21wdXRlIGNvc2luZSBzaW1pbGFyaXR5IGJldHdlZW4gY3VycmVudCBub3RlIGFuZCBhbGwgb3RoZXIgbm90ZXMgdmlhIGVtYmVkZGluZ3NcbiAgICAgIG5lYXJlc3QgPSB0aGlzLnNtYXJ0X3ZlY19saXRlLm5lYXJlc3QodmVjLCB7XG4gICAgICAgIHNraXBfa2V5OiBjdXJyX2tleSxcbiAgICAgICAgc2tpcF9zZWN0aW9uczogdGhpcy5zZXR0aW5ncy5za2lwX3NlY3Rpb25zLFxuICAgICAgfSk7XG4gIFxuICAgICAgLy8gc2F2ZSB0byB0aGlzLm5lYXJlc3RfY2FjaGVcbiAgICAgIHRoaXMubmVhcmVzdF9jYWNoZVtjdXJyX2tleV0gPSBuZWFyZXN0O1xuICAgIH1cblxuICAgIC8vIHJldHVybiBhcnJheSBzb3J0ZWQgYnkgY29zaW5lIHNpbWlsYXJpdHlcbiAgICByZXR1cm4gbmVhcmVzdDtcbiAgfVxuICBcbiAgLy8gY3JlYXRlIHJlbmRlcl9sb2cgb2JqZWN0IG9mIGV4bHVzaW9ucyB3aXRoIG51bWJlciBvZiB0aW1lcyBza2lwcGVkIGFzIHZhbHVlXG4gIGxvZ19leGNsdXNpb24oZXhjbHVzaW9uKSB7XG4gICAgLy8gaW5jcmVtZW50IHJlbmRlcl9sb2cgZm9yIHNraXBwZWQgZmlsZVxuICAgIHRoaXMucmVuZGVyX2xvZy5leGNsdXNpb25zX2xvZ3NbZXhjbHVzaW9uXSA9ICh0aGlzLnJlbmRlcl9sb2cuZXhjbHVzaW9uc19sb2dzW2V4Y2x1c2lvbl0gfHwgMCkgKyAxO1xuICB9XG4gIFxuXG4gIGJsb2NrX3BhcnNlcihtYXJrZG93biwgZmlsZV9wYXRoKXtcbiAgICAvLyBpZiB0aGlzLnNldHRpbmdzLnNraXBfc2VjdGlvbnMgaXMgdHJ1ZSB0aGVuIHJldHVybiBlbXB0eSBhcnJheVxuICAgIGlmKHRoaXMuc2V0dGluZ3Muc2tpcF9zZWN0aW9ucykge1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH1cbiAgICAvLyBzcGxpdCB0aGUgbWFya2Rvd24gaW50byBsaW5lc1xuICAgIGNvbnN0IGxpbmVzID0gbWFya2Rvd24uc3BsaXQoJ1xcbicpO1xuICAgIC8vIGluaXRpYWxpemUgdGhlIGJsb2NrcyBhcnJheVxuICAgIGxldCBibG9ja3MgPSBbXTtcbiAgICAvLyBjdXJyZW50IGhlYWRlcnMgYXJyYXlcbiAgICBsZXQgY3VycmVudEhlYWRlcnMgPSBbXTtcbiAgICAvLyByZW1vdmUgLm1kIGZpbGUgZXh0ZW5zaW9uIGFuZCBjb252ZXJ0IGZpbGVfcGF0aCB0byBicmVhZGNydW1iIGZvcm1hdHRpbmdcbiAgICBjb25zdCBmaWxlX2JyZWFkY3J1bWJzID0gZmlsZV9wYXRoLnJlcGxhY2UoJy5tZCcsICcnKS5yZXBsYWNlKC9cXC8vZywgJyA+ICcpO1xuICAgIC8vIGluaXRpYWxpemUgdGhlIGJsb2NrIHN0cmluZ1xuICAgIGxldCBibG9jayA9ICcnO1xuICAgIGxldCBibG9ja19oZWFkaW5ncyA9ICcnO1xuICAgIGxldCBibG9ja19wYXRoID0gZmlsZV9wYXRoO1xuXG4gICAgbGV0IGxhc3RfaGVhZGluZ19saW5lID0gMDtcbiAgICBsZXQgaSA9IDA7XG4gICAgbGV0IGJsb2NrX2hlYWRpbmdzX2xpc3QgPSBbXTtcbiAgICAvLyBsb29wIHRocm91Z2ggdGhlIGxpbmVzXG4gICAgZm9yIChpID0gMDsgaSA8IGxpbmVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAvLyBnZXQgdGhlIGxpbmVcbiAgICAgIGNvbnN0IGxpbmUgPSBsaW5lc1tpXTtcbiAgICAgIC8vIGlmIGxpbmUgZG9lcyBub3Qgc3RhcnQgd2l0aCAjXG4gICAgICAvLyBvciBpZiBsaW5lIHN0YXJ0cyB3aXRoICMgYW5kIHNlY29uZCBjaGFyYWN0ZXIgaXMgYSB3b3JkIG9yIG51bWJlciBpbmRpY2F0aW5nIGEgXCJ0YWdcIlxuICAgICAgLy8gdGhlbiBhZGQgdG8gYmxvY2tcbiAgICAgIGlmICghbGluZS5zdGFydHNXaXRoKCcjJykgfHwgKFsnIycsJyAnXS5pbmRleE9mKGxpbmVbMV0pIDwgMCkpe1xuICAgICAgICAvLyBza2lwIGlmIGxpbmUgaXMgZW1wdHlcbiAgICAgICAgaWYobGluZSA9PT0gJycpIGNvbnRpbnVlO1xuICAgICAgICAvLyBza2lwIGlmIGxpbmUgaXMgZW1wdHkgYnVsbGV0IG9yIGNoZWNrYm94XG4gICAgICAgIGlmKFsnLSAnLCAnLSBbIF0gJ10uaW5kZXhPZihsaW5lKSA+IC0xKSBjb250aW51ZTtcbiAgICAgICAgLy8gaWYgY3VycmVudEhlYWRlcnMgaXMgZW1wdHkgc2tpcCAob25seSBibG9ja3Mgd2l0aCBoZWFkZXJzLCBvdGhlcndpc2UgYmxvY2sucGF0aCBjb25mbGljdHMgd2l0aCBmaWxlLnBhdGgpXG4gICAgICAgIGlmKGN1cnJlbnRIZWFkZXJzLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgICAgIC8vIGFkZCBsaW5lIHRvIGJsb2NrXG4gICAgICAgIGJsb2NrICs9IFwiXFxuXCIgKyBsaW5lO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIC8qKlxuICAgICAgICogQkVHSU4gSGVhZGluZyBwYXJzaW5nXG4gICAgICAgKiAtIGxpa2VseSBhIGhlYWRpbmcgaWYgbWFkZSBpdCB0aGlzIGZhclxuICAgICAgICovXG4gICAgICBsYXN0X2hlYWRpbmdfbGluZSA9IGk7XG4gICAgICAvLyBwdXNoIHRoZSBjdXJyZW50IGJsb2NrIHRvIHRoZSBibG9ja3MgYXJyYXkgdW5sZXNzIGxhc3QgbGluZSB3YXMgYSBhbHNvIGEgaGVhZGVyXG4gICAgICBpZihpID4gMCAmJiAobGFzdF9oZWFkaW5nX2xpbmUgIT09IChpLTEpKSAmJiAoYmxvY2suaW5kZXhPZihcIlxcblwiKSA+IC0xKSAmJiB0aGlzLnZhbGlkYXRlX2hlYWRpbmdzKGJsb2NrX2hlYWRpbmdzKSkge1xuICAgICAgICBvdXRwdXRfYmxvY2soKTtcbiAgICAgIH1cbiAgICAgIC8vIGdldCB0aGUgaGVhZGVyIGxldmVsXG4gICAgICBjb25zdCBsZXZlbCA9IGxpbmUuc3BsaXQoJyMnKS5sZW5ndGggLSAxO1xuICAgICAgLy8gcmVtb3ZlIGFueSBoZWFkZXJzIGZyb20gdGhlIGN1cnJlbnQgaGVhZGVycyBhcnJheSB0aGF0IGFyZSBoaWdoZXIgdGhhbiB0aGUgY3VycmVudCBoZWFkZXIgbGV2ZWxcbiAgICAgIGN1cnJlbnRIZWFkZXJzID0gY3VycmVudEhlYWRlcnMuZmlsdGVyKGhlYWRlciA9PiBoZWFkZXIubGV2ZWwgPCBsZXZlbCk7XG4gICAgICAvLyBhZGQgaGVhZGVyIGFuZCBsZXZlbCB0byBjdXJyZW50IGhlYWRlcnMgYXJyYXlcbiAgICAgIC8vIHRyaW0gdGhlIGhlYWRlciB0byByZW1vdmUgXCIjXCIgYW5kIGFueSB0cmFpbGluZyBzcGFjZXNcbiAgICAgIGN1cnJlbnRIZWFkZXJzLnB1c2goe2hlYWRlcjogbGluZS5yZXBsYWNlKC8jL2csICcnKS50cmltKCksIGxldmVsOiBsZXZlbH0pO1xuICAgICAgLy8gaW5pdGlhbGl6ZSB0aGUgYmxvY2sgYnJlYWRjcnVtYnMgd2l0aCBmaWxlLnBhdGggdGhlIGN1cnJlbnQgaGVhZGVyc1xuICAgICAgYmxvY2sgPSBmaWxlX2JyZWFkY3J1bWJzO1xuICAgICAgYmxvY2sgKz0gXCI6IFwiICsgY3VycmVudEhlYWRlcnMubWFwKGhlYWRlciA9PiBoZWFkZXIuaGVhZGVyKS5qb2luKCcgPiAnKTtcbiAgICAgIGJsb2NrX2hlYWRpbmdzID0gXCIjXCIrY3VycmVudEhlYWRlcnMubWFwKGhlYWRlciA9PiBoZWFkZXIuaGVhZGVyKS5qb2luKCcjJyk7XG4gICAgICAvLyBpZiBibG9ja19oZWFkaW5ncyBpcyBhbHJlYWR5IGluIGJsb2NrX2hlYWRpbmdzX2xpc3QgdGhlbiBhZGQgYSBudW1iZXIgdG8gdGhlIGVuZFxuICAgICAgaWYoYmxvY2tfaGVhZGluZ3NfbGlzdC5pbmRleE9mKGJsb2NrX2hlYWRpbmdzKSA+IC0xKSB7XG4gICAgICAgIGxldCBjb3VudCA9IDE7XG4gICAgICAgIHdoaWxlKGJsb2NrX2hlYWRpbmdzX2xpc3QuaW5kZXhPZihgJHtibG9ja19oZWFkaW5nc317JHtjb3VudH19YCkgPiAtMSkge1xuICAgICAgICAgIGNvdW50Kys7XG4gICAgICAgIH1cbiAgICAgICAgYmxvY2tfaGVhZGluZ3MgPSBgJHtibG9ja19oZWFkaW5nc317JHtjb3VudH19YDtcbiAgICAgIH1cbiAgICAgIGJsb2NrX2hlYWRpbmdzX2xpc3QucHVzaChibG9ja19oZWFkaW5ncyk7XG4gICAgICBibG9ja19wYXRoID0gZmlsZV9wYXRoICsgYmxvY2tfaGVhZGluZ3M7XG4gICAgfVxuICAgIC8vIGhhbmRsZSByZW1haW5pbmcgYWZ0ZXIgbG9vcFxuICAgIGlmKChsYXN0X2hlYWRpbmdfbGluZSAhPT0gKGktMSkpICYmIChibG9jay5pbmRleE9mKFwiXFxuXCIpID4gLTEpICYmIHRoaXMudmFsaWRhdGVfaGVhZGluZ3MoYmxvY2tfaGVhZGluZ3MpKSBvdXRwdXRfYmxvY2soKTtcbiAgICAvLyByZW1vdmUgYW55IGJsb2NrcyB0aGF0IGFyZSB0b28gc2hvcnQgKGxlbmd0aCA8IDUwKVxuICAgIGJsb2NrcyA9IGJsb2Nrcy5maWx0ZXIoYiA9PiBiLmxlbmd0aCA+IDUwKTtcbiAgICAvLyBjb25zb2xlLmxvZyhibG9ja3MpO1xuICAgIC8vIHJldHVybiB0aGUgYmxvY2tzIGFycmF5XG4gICAgcmV0dXJuIGJsb2NrcztcblxuICAgIGZ1bmN0aW9uIG91dHB1dF9ibG9jaygpIHtcbiAgICAgIC8vIGJyZWFkY3J1bWJzIGxlbmd0aCAoZmlyc3QgbGluZSBvZiBibG9jaylcbiAgICAgIGNvbnN0IGJyZWFkY3J1bWJzX2xlbmd0aCA9IGJsb2NrLmluZGV4T2YoXCJcXG5cIikgKyAxO1xuICAgICAgY29uc3QgYmxvY2tfbGVuZ3RoID0gYmxvY2subGVuZ3RoIC0gYnJlYWRjcnVtYnNfbGVuZ3RoO1xuICAgICAgLy8gdHJpbSBibG9jayB0byBtYXggbGVuZ3RoXG4gICAgICBpZiAoYmxvY2subGVuZ3RoID4gTUFYX0VNQkVEX1NUUklOR19MRU5HVEgpIHtcbiAgICAgICAgYmxvY2sgPSBibG9jay5zdWJzdHJpbmcoMCwgTUFYX0VNQkVEX1NUUklOR19MRU5HVEgpO1xuICAgICAgfVxuICAgICAgYmxvY2tzLnB1c2goeyB0ZXh0OiBibG9jay50cmltKCksIHBhdGg6IGJsb2NrX3BhdGgsIGxlbmd0aDogYmxvY2tfbGVuZ3RoIH0pO1xuICAgIH1cbiAgfVxuICAvLyByZXZlcnNlLXJldHJpZXZlIGJsb2NrIGdpdmVuIHBhdGhcbiAgYXN5bmMgYmxvY2tfcmV0cmlldmVyKHBhdGgsIGxpbWl0cz17fSkge1xuICAgIGxpbWl0cyA9IHtcbiAgICAgIGxpbmVzOiBudWxsLFxuICAgICAgY2hhcnNfcGVyX2xpbmU6IG51bGwsXG4gICAgICBtYXhfY2hhcnM6IG51bGwsXG4gICAgICAuLi5saW1pdHNcbiAgICB9XG4gICAgLy8gcmV0dXJuIGlmIG5vICMgaW4gcGF0aFxuICAgIGlmIChwYXRoLmluZGV4T2YoJyMnKSA8IDApIHtcbiAgICAgIGNvbnNvbGUubG9nKFwibm90IGEgYmxvY2sgcGF0aDogXCIrcGF0aCk7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGxldCBibG9jayA9IFtdO1xuICAgIGxldCBibG9ja19oZWFkaW5ncyA9IHBhdGguc3BsaXQoJyMnKS5zbGljZSgxKTtcbiAgICAvLyBpZiBwYXRoIGVuZHMgd2l0aCBudW1iZXIgaW4gY3VybHkgYnJhY2VzXG4gICAgbGV0IGhlYWRpbmdfb2NjdXJyZW5jZSA9IDA7XG4gICAgaWYoYmxvY2tfaGVhZGluZ3NbYmxvY2tfaGVhZGluZ3MubGVuZ3RoLTFdLmluZGV4T2YoJ3snKSA+IC0xKSB7XG4gICAgICAvLyBnZXQgdGhlIG9jY3VycmVuY2UgbnVtYmVyXG4gICAgICBoZWFkaW5nX29jY3VycmVuY2UgPSBwYXJzZUludChibG9ja19oZWFkaW5nc1tibG9ja19oZWFkaW5ncy5sZW5ndGgtMV0uc3BsaXQoJ3snKVsxXS5yZXBsYWNlKCd9JywgJycpKTtcbiAgICAgIC8vIHJlbW92ZSB0aGUgb2NjdXJyZW5jZSBmcm9tIHRoZSBsYXN0IGhlYWRpbmdcbiAgICAgIGJsb2NrX2hlYWRpbmdzW2Jsb2NrX2hlYWRpbmdzLmxlbmd0aC0xXSA9IGJsb2NrX2hlYWRpbmdzW2Jsb2NrX2hlYWRpbmdzLmxlbmd0aC0xXS5zcGxpdCgneycpWzBdO1xuICAgIH1cbiAgICBsZXQgY3VycmVudEhlYWRlcnMgPSBbXTtcbiAgICBsZXQgb2NjdXJyZW5jZV9jb3VudCA9IDA7XG4gICAgbGV0IGJlZ2luX2xpbmUgPSAwO1xuICAgIGxldCBpID0gMDtcbiAgICAvLyBnZXQgZmlsZSBwYXRoIGZyb20gcGF0aFxuICAgIGNvbnN0IGZpbGVfcGF0aCA9IHBhdGguc3BsaXQoJyMnKVswXTtcbiAgICAvLyBnZXQgZmlsZVxuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoZmlsZV9wYXRoKTtcbiAgICBpZighKGZpbGUgaW5zdGFuY2VvZiBPYnNpZGlhbi5URmlsZSkpIHtcbiAgICAgIGNvbnNvbGUubG9nKFwibm90IGEgZmlsZTogXCIrZmlsZV9wYXRoKTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgLy8gZ2V0IGZpbGUgY29udGVudHNcbiAgICBjb25zdCBmaWxlX2NvbnRlbnRzID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKTtcbiAgICAvLyBzcGxpdCB0aGUgZmlsZSBjb250ZW50cyBpbnRvIGxpbmVzXG4gICAgY29uc3QgbGluZXMgPSBmaWxlX2NvbnRlbnRzLnNwbGl0KCdcXG4nKTtcbiAgICAvLyBsb29wIHRocm91Z2ggdGhlIGxpbmVzXG4gICAgbGV0IGlzX2NvZGUgPSBmYWxzZTtcbiAgICBmb3IgKGkgPSAwOyBpIDwgbGluZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgIC8vIGdldCB0aGUgbGluZVxuICAgICAgY29uc3QgbGluZSA9IGxpbmVzW2ldO1xuICAgICAgLy8gaWYgbGluZSBiZWdpbnMgd2l0aCB0aHJlZSBiYWNrdGlja3MgdGhlbiB0b2dnbGUgaXNfY29kZVxuICAgICAgaWYobGluZS5pbmRleE9mKCdgYGAnKSA9PT0gMCkge1xuICAgICAgICBpc19jb2RlID0gIWlzX2NvZGU7XG4gICAgICB9XG4gICAgICAvLyBpZiBpc19jb2RlIGlzIHRydWUgdGhlbiBhZGQgbGluZSB3aXRoIHByZWNlZGluZyB0YWIgYW5kIGNvbnRpbnVlXG4gICAgICBpZihpc19jb2RlKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgLy8gc2tpcCBpZiBsaW5lIGlzIGVtcHR5IGJ1bGxldCBvciBjaGVja2JveFxuICAgICAgaWYoWyctICcsICctIFsgXSAnXS5pbmRleE9mKGxpbmUpID4gLTEpIGNvbnRpbnVlO1xuICAgICAgLy8gaWYgbGluZSBkb2VzIG5vdCBzdGFydCB3aXRoICNcbiAgICAgIC8vIG9yIGlmIGxpbmUgc3RhcnRzIHdpdGggIyBhbmQgc2Vjb25kIGNoYXJhY3RlciBpcyBhIHdvcmQgb3IgbnVtYmVyIGluZGljYXRpbmcgYSBcInRhZ1wiXG4gICAgICAvLyB0aGVuIGNvbnRpbnVlIHRvIG5leHQgbGluZVxuICAgICAgaWYgKCFsaW5lLnN0YXJ0c1dpdGgoJyMnKSB8fCAoWycjJywnICddLmluZGV4T2YobGluZVsxXSkgPCAwKSl7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgLyoqXG4gICAgICAgKiBCRUdJTiBIZWFkaW5nIHBhcnNpbmdcbiAgICAgICAqIC0gbGlrZWx5IGEgaGVhZGluZyBpZiBtYWRlIGl0IHRoaXMgZmFyXG4gICAgICAgKi9cbiAgICAgIC8vIGdldCB0aGUgaGVhZGluZyB0ZXh0XG4gICAgICBjb25zdCBoZWFkaW5nX3RleHQgPSBsaW5lLnJlcGxhY2UoLyMvZywgJycpLnRyaW0oKTtcbiAgICAgIC8vIGNvbnRpbnVlIGlmIGhlYWRpbmcgdGV4dCBpcyBub3QgaW4gYmxvY2tfaGVhZGluZ3NcbiAgICAgIGNvbnN0IGhlYWRpbmdfaW5kZXggPSBibG9ja19oZWFkaW5ncy5pbmRleE9mKGhlYWRpbmdfdGV4dCk7XG4gICAgICBpZiAoaGVhZGluZ19pbmRleCA8IDApIGNvbnRpbnVlO1xuICAgICAgLy8gaWYgY3VycmVudEhlYWRlcnMubGVuZ3RoICE9PSBoZWFkaW5nX2luZGV4IHRoZW4gd2UgaGF2ZSBhIG1pc21hdGNoXG4gICAgICBpZiAoY3VycmVudEhlYWRlcnMubGVuZ3RoICE9PSBoZWFkaW5nX2luZGV4KSBjb250aW51ZTtcbiAgICAgIC8vIHB1c2ggdGhlIGhlYWRpbmcgdGV4dCB0byB0aGUgY3VycmVudEhlYWRlcnMgYXJyYXlcbiAgICAgIGN1cnJlbnRIZWFkZXJzLnB1c2goaGVhZGluZ190ZXh0KTtcbiAgICAgIC8vIGlmIGN1cnJlbnRIZWFkZXJzLmxlbmd0aCA9PT0gYmxvY2tfaGVhZGluZ3MubGVuZ3RoIHRoZW4gd2UgaGF2ZSBhIG1hdGNoXG4gICAgICBpZiAoY3VycmVudEhlYWRlcnMubGVuZ3RoID09PSBibG9ja19oZWFkaW5ncy5sZW5ndGgpIHtcbiAgICAgICAgLy8gaWYgaGVhZGluZ19vY2N1cnJlbmNlIGlzIGRlZmluZWQgdGhlbiBpbmNyZW1lbnQgb2NjdXJyZW5jZV9jb3VudFxuICAgICAgICBpZihoZWFkaW5nX29jY3VycmVuY2UgPT09IDApIHtcbiAgICAgICAgICAvLyBzZXQgYmVnaW5fbGluZSB0byBpICsgMVxuICAgICAgICAgIGJlZ2luX2xpbmUgPSBpICsgMTtcbiAgICAgICAgICBicmVhazsgLy8gYnJlYWsgb3V0IG9mIGxvb3BcbiAgICAgICAgfVxuICAgICAgICAvLyBpZiBvY2N1cnJlbmNlX2NvdW50ICE9PSBoZWFkaW5nX29jY3VycmVuY2UgdGhlbiBjb250aW51ZVxuICAgICAgICBpZihvY2N1cnJlbmNlX2NvdW50ID09PSBoZWFkaW5nX29jY3VycmVuY2Upe1xuICAgICAgICAgIGJlZ2luX2xpbmUgPSBpICsgMTtcbiAgICAgICAgICBicmVhazsgLy8gYnJlYWsgb3V0IG9mIGxvb3BcbiAgICAgICAgfVxuICAgICAgICBvY2N1cnJlbmNlX2NvdW50Kys7XG4gICAgICAgIC8vIHJlc2V0IGN1cnJlbnRIZWFkZXJzXG4gICAgICAgIGN1cnJlbnRIZWFkZXJzLnBvcCgpO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgLy8gaWYgbm8gYmVnaW5fbGluZSB0aGVuIHJldHVybiBmYWxzZVxuICAgIGlmIChiZWdpbl9saW5lID09PSAwKSByZXR1cm4gZmFsc2U7XG4gICAgLy8gaXRlcmF0ZSB0aHJvdWdoIGxpbmVzIHN0YXJ0aW5nIGF0IGJlZ2luX2xpbmVcbiAgICBpc19jb2RlID0gZmFsc2U7XG4gICAgLy8gY2hhcmFjdGVyIGFjY3VtdWxhdG9yXG4gICAgbGV0IGNoYXJfY291bnQgPSAwO1xuICAgIGZvciAoaSA9IGJlZ2luX2xpbmU7IGkgPCBsaW5lcy5sZW5ndGg7IGkrKykge1xuICAgICAgaWYoKHR5cGVvZiBsaW5lX2xpbWl0ID09PSBcIm51bWJlclwiKSAmJiAoYmxvY2subGVuZ3RoID4gbGluZV9saW1pdCkpe1xuICAgICAgICBibG9jay5wdXNoKFwiLi4uXCIpO1xuICAgICAgICBicmVhazsgLy8gZW5kcyB3aGVuIGxpbmVfbGltaXQgaXMgcmVhY2hlZFxuICAgICAgfVxuICAgICAgbGV0IGxpbmUgPSBsaW5lc1tpXTtcbiAgICAgIGlmICgobGluZS5pbmRleE9mKCcjJykgPT09IDApICYmIChbJyMnLCcgJ10uaW5kZXhPZihsaW5lWzFdKSAhPT0gLTEpKXtcbiAgICAgICAgYnJlYWs7IC8vIGVuZHMgd2hlbiBlbmNvdW50ZXJpbmcgbmV4dCBoZWFkZXJcbiAgICAgIH1cbiAgICAgIC8vIERFUFJFQ0FURUQ6IHNob3VsZCBiZSBoYW5kbGVkIGJ5IG5ld19saW5lK2NoYXJfY291bnQgY2hlY2sgKGhhcHBlbnMgaW4gcHJldmlvdXMgaXRlcmF0aW9uKVxuICAgICAgLy8gaWYgY2hhcl9jb3VudCBpcyBncmVhdGVyIHRoYW4gbGltaXQubWF4X2NoYXJzLCBza2lwXG4gICAgICBpZiAobGltaXRzLm1heF9jaGFycyAmJiBjaGFyX2NvdW50ID4gbGltaXRzLm1heF9jaGFycykge1xuICAgICAgICBibG9jay5wdXNoKFwiLi4uXCIpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIC8vIGlmIG5ld19saW5lICsgY2hhcl9jb3VudCBpcyBncmVhdGVyIHRoYW4gbGltaXQubWF4X2NoYXJzLCBza2lwXG4gICAgICBpZiAobGltaXRzLm1heF9jaGFycyAmJiAoKGxpbmUubGVuZ3RoICsgY2hhcl9jb3VudCkgPiBsaW1pdHMubWF4X2NoYXJzKSkge1xuICAgICAgICBjb25zdCBtYXhfbmV3X2NoYXJzID0gbGltaXRzLm1heF9jaGFycyAtIGNoYXJfY291bnQ7XG4gICAgICAgIGxpbmUgPSBsaW5lLnNsaWNlKDAsIG1heF9uZXdfY2hhcnMpICsgXCIuLi5cIjtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICAvLyB2YWxpZGF0ZS9mb3JtYXRcbiAgICAgIC8vIGlmIGxpbmUgaXMgZW1wdHksIHNraXBcbiAgICAgIGlmIChsaW5lLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgICAvLyBsaW1pdCBsZW5ndGggb2YgbGluZSB0byBOIGNoYXJhY3RlcnNcbiAgICAgIGlmIChsaW1pdHMuY2hhcnNfcGVyX2xpbmUgJiYgbGluZS5sZW5ndGggPiBsaW1pdHMuY2hhcnNfcGVyX2xpbmUpIHtcbiAgICAgICAgbGluZSA9IGxpbmUuc2xpY2UoMCwgbGltaXRzLmNoYXJzX3Blcl9saW5lKSArIFwiLi4uXCI7XG4gICAgICB9XG4gICAgICAvLyBpZiBsaW5lIGlzIGEgY29kZSBibG9jaywgc2tpcFxuICAgICAgaWYgKGxpbmUuc3RhcnRzV2l0aChcImBgYFwiKSkge1xuICAgICAgICBpc19jb2RlID0gIWlzX2NvZGU7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGlzX2NvZGUpe1xuICAgICAgICAvLyBhZGQgdGFiIHRvIGJlZ2lubmluZyBvZiBsaW5lXG4gICAgICAgIGxpbmUgPSBcIlxcdFwiK2xpbmU7XG4gICAgICB9XG4gICAgICAvLyBhZGQgbGluZSB0byBibG9ja1xuICAgICAgYmxvY2sucHVzaChsaW5lKTtcbiAgICAgIC8vIGluY3JlbWVudCBjaGFyX2NvdW50XG4gICAgICBjaGFyX2NvdW50ICs9IGxpbmUubGVuZ3RoO1xuICAgIH1cbiAgICAvLyBjbG9zZSBjb2RlIGJsb2NrIGlmIG9wZW5cbiAgICBpZiAoaXNfY29kZSkge1xuICAgICAgYmxvY2sucHVzaChcImBgYFwiKTtcbiAgICB9XG4gICAgcmV0dXJuIGJsb2NrLmpvaW4oXCJcXG5cIikudHJpbSgpO1xuICB9XG5cbiAgLy8gcmV0cmlldmUgYSBmaWxlIGZyb20gdGhlIHZhdWx0XG4gIGFzeW5jIGZpbGVfcmV0cmlldmVyKGxpbmssIGxpbWl0cz17fSkge1xuICAgIGxpbWl0cyA9IHtcbiAgICAgIGxpbmVzOiBudWxsLFxuICAgICAgbWF4X2NoYXJzOiBudWxsLFxuICAgICAgY2hhcnNfcGVyX2xpbmU6IG51bGwsXG4gICAgICAuLi5saW1pdHNcbiAgICB9O1xuICAgIGNvbnN0IHRoaXNfZmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChsaW5rKTtcbiAgICAvLyBpZiBmaWxlIGlzIG5vdCBmb3VuZCwgc2tpcFxuICAgIGlmICghKHRoaXNfZmlsZSBpbnN0YW5jZW9mIE9ic2lkaWFuLlRBYnN0cmFjdEZpbGUpKSByZXR1cm4gZmFsc2U7XG4gICAgLy8gdXNlIGNhY2hlZFJlYWQgdG8gZ2V0IHRoZSBmaXJzdCAxMCBsaW5lcyBvZiB0aGUgZmlsZVxuICAgIGNvbnN0IGZpbGVfY29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQodGhpc19maWxlKTtcbiAgICBjb25zdCBmaWxlX2xpbmVzID0gZmlsZV9jb250ZW50LnNwbGl0KFwiXFxuXCIpO1xuICAgIGxldCBmaXJzdF90ZW5fbGluZXMgPSBbXTtcbiAgICBsZXQgaXNfY29kZSA9IGZhbHNlO1xuICAgIGxldCBjaGFyX2FjY3VtID0gMDtcbiAgICBjb25zdCBsaW5lX2xpbWl0ID0gbGltaXRzLmxpbmVzIHx8IGZpbGVfbGluZXMubGVuZ3RoO1xuICAgIGZvciAobGV0IGkgPSAwOyBmaXJzdF90ZW5fbGluZXMubGVuZ3RoIDwgbGluZV9saW1pdDsgaSsrKSB7XG4gICAgICBsZXQgbGluZSA9IGZpbGVfbGluZXNbaV07XG4gICAgICAvLyBpZiBsaW5lIGlzIHVuZGVmaW5lZCwgYnJlYWtcbiAgICAgIGlmICh0eXBlb2YgbGluZSA9PT0gJ3VuZGVmaW5lZCcpXG4gICAgICAgIGJyZWFrO1xuICAgICAgLy8gaWYgbGluZSBpcyBlbXB0eSwgc2tpcFxuICAgICAgaWYgKGxpbmUubGVuZ3RoID09PSAwKVxuICAgICAgICBjb250aW51ZTtcbiAgICAgIC8vIGxpbWl0IGxlbmd0aCBvZiBsaW5lIHRvIE4gY2hhcmFjdGVyc1xuICAgICAgaWYgKGxpbWl0cy5jaGFyc19wZXJfbGluZSAmJiBsaW5lLmxlbmd0aCA+IGxpbWl0cy5jaGFyc19wZXJfbGluZSkge1xuICAgICAgICBsaW5lID0gbGluZS5zbGljZSgwLCBsaW1pdHMuY2hhcnNfcGVyX2xpbmUpICsgXCIuLi5cIjtcbiAgICAgIH1cbiAgICAgIC8vIGlmIGxpbmUgaXMgXCItLS1cIiwgc2tpcFxuICAgICAgaWYgKGxpbmUgPT09IFwiLS0tXCIpXG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgLy8gc2tpcCBpZiBsaW5lIGlzIGVtcHR5IGJ1bGxldCBvciBjaGVja2JveFxuICAgICAgaWYgKFsnLSAnLCAnLSBbIF0gJ10uaW5kZXhPZihsaW5lKSA+IC0xKVxuICAgICAgICBjb250aW51ZTtcbiAgICAgIC8vIGlmIGxpbmUgaXMgYSBjb2RlIGJsb2NrLCBza2lwXG4gICAgICBpZiAobGluZS5pbmRleE9mKFwiYGBgXCIpID09PSAwKSB7XG4gICAgICAgIGlzX2NvZGUgPSAhaXNfY29kZTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICAvLyBpZiBjaGFyX2FjY3VtIGlzIGdyZWF0ZXIgdGhhbiBsaW1pdC5tYXhfY2hhcnMsIHNraXBcbiAgICAgIGlmIChsaW1pdHMubWF4X2NoYXJzICYmIGNoYXJfYWNjdW0gPiBsaW1pdHMubWF4X2NoYXJzKSB7XG4gICAgICAgIGZpcnN0X3Rlbl9saW5lcy5wdXNoKFwiLi4uXCIpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGlmIChpc19jb2RlKSB7XG4gICAgICAgIC8vIGlmIGlzIGNvZGUsIGFkZCB0YWIgdG8gYmVnaW5uaW5nIG9mIGxpbmVcbiAgICAgICAgbGluZSA9IFwiXFx0XCIgKyBsaW5lO1xuICAgICAgfVxuICAgICAgLy8gaWYgbGluZSBpcyBhIGhlYWRpbmdcbiAgICAgIGlmIChsaW5lX2lzX2hlYWRpbmcobGluZSkpIHtcbiAgICAgICAgLy8gbG9vayBhdCBsYXN0IGxpbmUgaW4gZmlyc3RfdGVuX2xpbmVzIHRvIHNlZSBpZiBpdCBpcyBhIGhlYWRpbmdcbiAgICAgICAgLy8gbm90ZTogdXNlcyBsYXN0IGluIGZpcnN0X3Rlbl9saW5lcywgaW5zdGVhZCBvZiBsb29rIGFoZWFkIGluIGZpbGVfbGluZXMsIGJlY2F1c2UuLlxuICAgICAgICAvLyAuLi5uZXh0IGxpbmUgbWF5IGJlIGV4Y2x1ZGVkIGZyb20gZmlyc3RfdGVuX2xpbmVzIGJ5IHByZXZpb3VzIGlmIHN0YXRlbWVudHNcbiAgICAgICAgaWYgKChmaXJzdF90ZW5fbGluZXMubGVuZ3RoID4gMCkgJiYgbGluZV9pc19oZWFkaW5nKGZpcnN0X3Rlbl9saW5lc1tmaXJzdF90ZW5fbGluZXMubGVuZ3RoIC0gMV0pKSB7XG4gICAgICAgICAgLy8gaWYgbGFzdCBsaW5lIGlzIGEgaGVhZGluZywgcmVtb3ZlIGl0XG4gICAgICAgICAgZmlyc3RfdGVuX2xpbmVzLnBvcCgpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICAvLyBhZGQgbGluZSB0byBmaXJzdF90ZW5fbGluZXNcbiAgICAgIGZpcnN0X3Rlbl9saW5lcy5wdXNoKGxpbmUpO1xuICAgICAgLy8gaW5jcmVtZW50IGNoYXJfYWNjdW1cbiAgICAgIGNoYXJfYWNjdW0gKz0gbGluZS5sZW5ndGg7XG4gICAgfVxuICAgIC8vIGZvciBlYWNoIGxpbmUgaW4gZmlyc3RfdGVuX2xpbmVzLCBhcHBseSB2aWV3LXNwZWNpZmljIGZvcm1hdHRpbmdcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGZpcnN0X3Rlbl9saW5lcy5sZW5ndGg7IGkrKykge1xuICAgICAgLy8gaWYgbGluZSBpcyBhIGhlYWRpbmdcbiAgICAgIGlmIChsaW5lX2lzX2hlYWRpbmcoZmlyc3RfdGVuX2xpbmVzW2ldKSkge1xuICAgICAgICAvLyBpZiB0aGlzIGlzIHRoZSBsYXN0IGxpbmUgaW4gZmlyc3RfdGVuX2xpbmVzXG4gICAgICAgIGlmIChpID09PSBmaXJzdF90ZW5fbGluZXMubGVuZ3RoIC0gMSkge1xuICAgICAgICAgIC8vIHJlbW92ZSB0aGUgbGFzdCBsaW5lIGlmIGl0IGlzIGEgaGVhZGluZ1xuICAgICAgICAgIGZpcnN0X3Rlbl9saW5lcy5wb3AoKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICAvLyByZW1vdmUgaGVhZGluZyBzeW50YXggdG8gaW1wcm92ZSByZWFkYWJpbGl0eSBpbiBzbWFsbCBzcGFjZVxuICAgICAgICBmaXJzdF90ZW5fbGluZXNbaV0gPSBmaXJzdF90ZW5fbGluZXNbaV0ucmVwbGFjZSgvIysvLCBcIlwiKTtcbiAgICAgICAgZmlyc3RfdGVuX2xpbmVzW2ldID0gYFxcbiR7Zmlyc3RfdGVuX2xpbmVzW2ldfTpgO1xuICAgICAgfVxuICAgIH1cbiAgICAvLyBqb2luIGZpcnN0IHRlbiBsaW5lcyBpbnRvIHN0cmluZ1xuICAgIGZpcnN0X3Rlbl9saW5lcyA9IGZpcnN0X3Rlbl9saW5lcy5qb2luKFwiXFxuXCIpO1xuICAgIHJldHVybiBmaXJzdF90ZW5fbGluZXM7XG4gIH1cblxuICAvLyBpdGVyYXRlIHRocm91Z2ggYmxvY2tzIGFuZCBza2lwIGlmIGJsb2NrX2hlYWRpbmdzIGNvbnRhaW5zIHRoaXMuaGVhZGVyX2V4Y2x1c2lvbnNcbiAgdmFsaWRhdGVfaGVhZGluZ3MoYmxvY2tfaGVhZGluZ3MpIHtcbiAgICBsZXQgdmFsaWQgPSB0cnVlO1xuICAgIGlmICh0aGlzLmhlYWRlcl9leGNsdXNpb25zLmxlbmd0aCA+IDApIHtcbiAgICAgIGZvciAobGV0IGsgPSAwOyBrIDwgdGhpcy5oZWFkZXJfZXhjbHVzaW9ucy5sZW5ndGg7IGsrKykge1xuICAgICAgICBpZiAoYmxvY2tfaGVhZGluZ3MuaW5kZXhPZih0aGlzLmhlYWRlcl9leGNsdXNpb25zW2tdKSA+IC0xKSB7XG4gICAgICAgICAgdmFsaWQgPSBmYWxzZTtcbiAgICAgICAgICB0aGlzLmxvZ19leGNsdXNpb24oXCJoZWFkaW5nOiBcIit0aGlzLmhlYWRlcl9leGNsdXNpb25zW2tdKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gdmFsaWQ7XG4gIH1cbiAgLy8gcmVuZGVyIFwiU21hcnQgQ29ubmVjdGlvbnNcIiB0ZXh0IGZpeGVkIGluIHRoZSBib3R0b20gcmlnaHQgY29ybmVyXG4gIHJlbmRlcl9icmFuZChjb250YWluZXIsIGxvY2F0aW9uPVwiZGVmYXVsdFwiKSB7XG4gICAgLy8gaWYgbG9jYXRpb24gaXMgYWxsIHRoZW4gZ2V0IE9iamVjdC5rZXlzKHRoaXMuc2NfYnJhbmRpbmcpIGFuZCBjYWxsIHRoaXMgZnVuY3Rpb24gZm9yIGVhY2hcbiAgICBpZiAoY29udGFpbmVyID09PSBcImFsbFwiKSB7XG4gICAgICBjb25zdCBsb2NhdGlvbnMgPSBPYmplY3Qua2V5cyh0aGlzLnNjX2JyYW5kaW5nKTtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbG9jYXRpb25zLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHRoaXMucmVuZGVyX2JyYW5kKHRoaXMuc2NfYnJhbmRpbmdbbG9jYXRpb25zW2ldXSwgbG9jYXRpb25zW2ldKTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgLy8gYnJhbmQgY29udGFpbmVyXG4gICAgdGhpcy5zY19icmFuZGluZ1tsb2NhdGlvbl0gPSBjb250YWluZXI7XG4gICAgLy8gaWYgdGhpcy5zY19icmFuZGluZ1tsb2NhdGlvbl0gY29udGFpbnMgY2hpbGQgd2l0aCBjbGFzcyBcInNjLWJyYW5kXCIsIHJlbW92ZSBpdFxuICAgIGlmICh0aGlzLnNjX2JyYW5kaW5nW2xvY2F0aW9uXS5xdWVyeVNlbGVjdG9yKFwiLnNjLWJyYW5kXCIpKSB7XG4gICAgICB0aGlzLnNjX2JyYW5kaW5nW2xvY2F0aW9uXS5xdWVyeVNlbGVjdG9yKFwiLnNjLWJyYW5kXCIpLnJlbW92ZSgpO1xuICAgIH1cbiAgICBjb25zdCBicmFuZF9jb250YWluZXIgPSB0aGlzLnNjX2JyYW5kaW5nW2xvY2F0aW9uXS5jcmVhdGVFbChcImRpdlwiLCB7IGNsczogXCJzYy1icmFuZFwiIH0pO1xuICAgIC8vIGFkZCB0ZXh0XG4gICAgLy8gYWRkIFNWRyBzaWduYWwgaWNvbiB1c2luZyBnZXRJY29uXG4gICAgT2JzaWRpYW4uc2V0SWNvbihicmFuZF9jb250YWluZXIsIFwic21hcnQtY29ubmVjdGlvbnNcIik7XG4gICAgY29uc3QgYnJhbmRfcCA9IGJyYW5kX2NvbnRhaW5lci5jcmVhdGVFbChcInBcIik7XG4gICAgbGV0IHRleHQgPSBcIlNtYXJ0IENvbm5lY3Rpb25zXCI7XG4gICAgbGV0IGF0dHIgPSB7fTtcbiAgICAvLyBpZiB1cGRhdGUgYXZhaWxhYmxlLCBjaGFuZ2UgdGV4dCB0byBcIlVwZGF0ZSBBdmFpbGFibGVcIlxuICAgIGlmICh0aGlzLnVwZGF0ZV9hdmFpbGFibGUpIHtcbiAgICAgIHRleHQgPSBcIlVwZGF0ZSBBdmFpbGFibGVcIjtcbiAgICAgIGF0dHIgPSB7XG4gICAgICAgIHN0eWxlOiBcImZvbnQtd2VpZ2h0OiA3MDA7XCJcbiAgICAgIH07XG4gICAgfVxuICAgIGJyYW5kX3AuY3JlYXRlRWwoXCJhXCIsIHtcbiAgICAgIGNsczogXCJcIixcbiAgICAgIHRleHQ6IHRleHQsXG4gICAgICBocmVmOiBcImh0dHBzOi8vZ2l0aHViLmNvbS9icmlhbnBldHJvL29ic2lkaWFuLXNtYXJ0LWNvbm5lY3Rpb25zL2Rpc2N1c3Npb25zXCIsXG4gICAgICB0YXJnZXQ6IFwiX2JsYW5rXCIsXG4gICAgICBhdHRyOiBhdHRyXG4gICAgfSk7XG4gIH1cblxuXG4gIC8vIGNyZWF0ZSBsaXN0IG9mIG5lYXJlc3Qgbm90ZXNcbiAgYXN5bmMgdXBkYXRlX3Jlc3VsdHMoY29udGFpbmVyLCBuZWFyZXN0KSB7XG4gICAgbGV0IGxpc3Q7XG4gICAgLy8gY2hlY2sgaWYgbGlzdCBleGlzdHNcbiAgICBpZigoY29udGFpbmVyLmNoaWxkcmVuLmxlbmd0aCA+IDEpICYmIChjb250YWluZXIuY2hpbGRyZW5bMV0uY2xhc3NMaXN0LmNvbnRhaW5zKFwic2MtbGlzdFwiKSkpe1xuICAgICAgbGlzdCA9IGNvbnRhaW5lci5jaGlsZHJlblsxXTtcbiAgICB9XG4gICAgLy8gaWYgbGlzdCBleGlzdHMsIGVtcHR5IGl0XG4gICAgaWYgKGxpc3QpIHtcbiAgICAgIGxpc3QuZW1wdHkoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gY3JlYXRlIGxpc3QgZWxlbWVudFxuICAgICAgbGlzdCA9IGNvbnRhaW5lci5jcmVhdGVFbChcImRpdlwiLCB7IGNsczogXCJzYy1saXN0XCIgfSk7XG4gICAgfVxuICAgIGxldCBzZWFyY2hfcmVzdWx0X2NsYXNzID0gXCJzZWFyY2gtcmVzdWx0XCI7XG4gICAgLy8gaWYgc2V0dGluZ3MgZXhwYW5kZWRfdmlldyBpcyBmYWxzZSwgYWRkIHNjLWNvbGxhcHNlZCBjbGFzc1xuICAgIGlmKCF0aGlzLnNldHRpbmdzLmV4cGFuZGVkX3ZpZXcpIHNlYXJjaF9yZXN1bHRfY2xhc3MgKz0gXCIgc2MtY29sbGFwc2VkXCI7XG5cbiAgICAvLyBUT0RPOiBhZGQgb3B0aW9uIHRvIGdyb3VwIG5lYXJlc3QgYnkgZmlsZVxuICAgIGlmKCF0aGlzLnNldHRpbmdzLmdyb3VwX25lYXJlc3RfYnlfZmlsZSkge1xuICAgICAgLy8gZm9yIGVhY2ggbmVhcmVzdCBub3RlXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IG5lYXJlc3QubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIEJFR0lOIEVYVEVSTkFMIExJTksgTE9HSUNcbiAgICAgICAgICogaWYgbGluayBpcyBhbiBvYmplY3QsIGl0IGluZGljYXRlcyBleHRlcm5hbCBsaW5rXG4gICAgICAgICAqL1xuICAgICAgICBpZiAodHlwZW9mIG5lYXJlc3RbaV0ubGluayA9PT0gXCJvYmplY3RcIikge1xuICAgICAgICAgIGNvbnN0IGl0ZW0gPSBsaXN0LmNyZWF0ZUVsKFwiZGl2XCIsIHsgY2xzOiBcInNlYXJjaC1yZXN1bHRcIiB9KTtcbiAgICAgICAgICBjb25zdCBsaW5rID0gaXRlbS5jcmVhdGVFbChcImFcIiwge1xuICAgICAgICAgICAgY2xzOiBcInNlYXJjaC1yZXN1bHQtZmlsZS10aXRsZSBpcy1jbGlja2FibGVcIixcbiAgICAgICAgICAgIGhyZWY6IG5lYXJlc3RbaV0ubGluay5wYXRoLFxuICAgICAgICAgICAgdGl0bGU6IG5lYXJlc3RbaV0ubGluay50aXRsZSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBsaW5rLmlubmVySFRNTCA9IHRoaXMucmVuZGVyX2V4dGVybmFsX2xpbmtfZWxtKG5lYXJlc3RbaV0ubGluayk7XG4gICAgICAgICAgaXRlbS5zZXRBdHRyKCdkcmFnZ2FibGUnLCAndHJ1ZScpXG4gICAgICAgICAgY29udGludWU7IC8vIGVuZHMgaGVyZSBmb3IgZXh0ZXJuYWwgbGlua3NcbiAgICAgICAgfVxuICAgICAgICAvKipcbiAgICAgICAgICogQkVHSU4gSU5URVJOQUwgTElOSyBMT0dJQ1xuICAgICAgICAgKiBpZiBsaW5rIGlzIGEgc3RyaW5nLCBpdCBpbmRpY2F0ZXMgaW50ZXJuYWwgbGlua1xuICAgICAgICAgKi9cbiAgICAgICAgbGV0IGZpbGVfbGlua190ZXh0O1xuICAgICAgICBjb25zdCBmaWxlX3NpbWlsYXJpdHlfcGN0ID0gTWF0aC5yb3VuZChuZWFyZXN0W2ldLnNpbWlsYXJpdHkgKiAxMDApICsgXCIlXCI7XG4gICAgICAgIGlmKHRoaXMuc2V0dGluZ3Muc2hvd19mdWxsX3BhdGgpIHtcbiAgICAgICAgICBjb25zdCBwY3MgPSBuZWFyZXN0W2ldLmxpbmsuc3BsaXQoXCIvXCIpO1xuICAgICAgICAgIGZpbGVfbGlua190ZXh0ID0gcGNzW3Bjcy5sZW5ndGggLSAxXTtcbiAgICAgICAgICBjb25zdCBwYXRoID0gcGNzLnNsaWNlKDAsIHBjcy5sZW5ndGggLSAxKS5qb2luKFwiL1wiKTtcbiAgICAgICAgICAvLyBmaWxlX2xpbmtfdGV4dCA9IGA8c21hbGw+JHtwYXRofSB8ICR7ZmlsZV9zaW1pbGFyaXR5X3BjdH08L3NtYWxsPjxicj4ke2ZpbGVfbGlua190ZXh0fWA7XG4gICAgICAgICAgZmlsZV9saW5rX3RleHQgPSBgPHNtYWxsPiR7ZmlsZV9zaW1pbGFyaXR5X3BjdH0gfCAke3BhdGh9IHwgJHtmaWxlX2xpbmtfdGV4dH08L3NtYWxsPmA7XG4gICAgICAgIH1lbHNle1xuICAgICAgICAgIGZpbGVfbGlua190ZXh0ID0gJzxzbWFsbD4nICsgZmlsZV9zaW1pbGFyaXR5X3BjdCArIFwiIHwgXCIgKyBuZWFyZXN0W2ldLmxpbmsuc3BsaXQoXCIvXCIpLnBvcCgpICsgJzwvc21hbGw+JztcbiAgICAgICAgfVxuICAgICAgICAvLyBza2lwIGNvbnRlbnRzIHJlbmRlcmluZyBpZiBpbmNvbXBhdGlibGUgZmlsZSB0eXBlXG4gICAgICAgIC8vIGV4LiBub3QgbWFya2Rvd24gZmlsZSBvciBjb250YWlucyBubyAnLmV4Y2FsaWRyYXcnXG4gICAgICAgIGlmKCF0aGlzLnJlbmRlcmFibGVfZmlsZV90eXBlKG5lYXJlc3RbaV0ubGluaykpe1xuICAgICAgICAgIGNvbnN0IGl0ZW0gPSBsaXN0LmNyZWF0ZUVsKFwiZGl2XCIsIHsgY2xzOiBcInNlYXJjaC1yZXN1bHRcIiB9KTtcbiAgICAgICAgICBjb25zdCBsaW5rID0gaXRlbS5jcmVhdGVFbChcImFcIiwge1xuICAgICAgICAgICAgY2xzOiBcInNlYXJjaC1yZXN1bHQtZmlsZS10aXRsZSBpcy1jbGlja2FibGVcIixcbiAgICAgICAgICAgIGhyZWY6IG5lYXJlc3RbaV0ubGluayxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBsaW5rLmlubmVySFRNTCA9IGZpbGVfbGlua190ZXh0O1xuICAgICAgICAgIC8vIGRyYWcgYW5kIGRyb3BcbiAgICAgICAgICBpdGVtLnNldEF0dHIoJ2RyYWdnYWJsZScsICd0cnVlJylcbiAgICAgICAgICAvLyBhZGQgbGlzdGVuZXJzIHRvIGxpbmtcbiAgICAgICAgICB0aGlzLmFkZF9saW5rX2xpc3RlbmVycyhsaW5rLCBuZWFyZXN0W2ldLCBpdGVtKTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHJlbW92ZSBmaWxlIGV4dGVuc2lvbiBpZiAubWQgYW5kIG1ha2UgIyBpbnRvID5cbiAgICAgICAgZmlsZV9saW5rX3RleHQgPSBmaWxlX2xpbmtfdGV4dC5yZXBsYWNlKFwiLm1kXCIsIFwiXCIpLnJlcGxhY2UoLyMvZywgXCIgPiBcIik7XG4gICAgICAgIC8vIGNyZWF0ZSBpdGVtXG4gICAgICAgIGNvbnN0IGl0ZW0gPSBsaXN0LmNyZWF0ZUVsKFwiZGl2XCIsIHsgY2xzOiBzZWFyY2hfcmVzdWx0X2NsYXNzIH0pO1xuICAgICAgICAvLyBjcmVhdGUgc3BhbiBmb3IgdG9nZ2xlXG4gICAgICAgIGNvbnN0IHRvZ2dsZSA9IGl0ZW0uY3JlYXRlRWwoXCJzcGFuXCIsIHsgY2xzOiBcImlzLWNsaWNrYWJsZVwiIH0pO1xuICAgICAgICAvLyBpbnNlcnQgcmlnaHQgdHJpYW5nbGUgc3ZnIGFzIHRvZ2dsZVxuICAgICAgICBPYnNpZGlhbi5zZXRJY29uKHRvZ2dsZSwgXCJyaWdodC10cmlhbmdsZVwiKTsgLy8gbXVzdCBjb21lIGJlZm9yZSBhZGRpbmcgb3RoZXIgZWxtcyB0byBwcmV2ZW50IG92ZXJ3cml0ZVxuICAgICAgICBjb25zdCBsaW5rID0gdG9nZ2xlLmNyZWF0ZUVsKFwiYVwiLCB7XG4gICAgICAgICAgY2xzOiBcInNlYXJjaC1yZXN1bHQtZmlsZS10aXRsZVwiLFxuICAgICAgICAgIHRpdGxlOiBuZWFyZXN0W2ldLmxpbmssXG4gICAgICAgIH0pO1xuICAgICAgICBsaW5rLmlubmVySFRNTCA9IGZpbGVfbGlua190ZXh0O1xuICAgICAgICAvLyBhZGQgbGlzdGVuZXJzIHRvIGxpbmtcbiAgICAgICAgdGhpcy5hZGRfbGlua19saXN0ZW5lcnMobGluaywgbmVhcmVzdFtpXSwgaXRlbSk7XG4gICAgICAgIHRvZ2dsZS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiB7XG4gICAgICAgICAgLy8gZmluZCBwYXJlbnQgY29udGFpbmluZyBzZWFyY2gtcmVzdWx0IGNsYXNzXG4gICAgICAgICAgbGV0IHBhcmVudCA9IGV2ZW50LnRhcmdldC5wYXJlbnRFbGVtZW50O1xuICAgICAgICAgIHdoaWxlICghcGFyZW50LmNsYXNzTGlzdC5jb250YWlucyhcInNlYXJjaC1yZXN1bHRcIikpIHtcbiAgICAgICAgICAgIHBhcmVudCA9IHBhcmVudC5wYXJlbnRFbGVtZW50O1xuICAgICAgICAgIH1cbiAgICAgICAgICAvLyB0b2dnbGUgc2MtY29sbGFwc2VkIGNsYXNzXG4gICAgICAgICAgcGFyZW50LmNsYXNzTGlzdC50b2dnbGUoXCJzYy1jb2xsYXBzZWRcIik7XG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCBjb250ZW50cyA9IGl0ZW0uY3JlYXRlRWwoXCJ1bFwiLCB7IGNsczogXCJcIiB9KTtcbiAgICAgICAgY29uc3QgY29udGVudHNfY29udGFpbmVyID0gY29udGVudHMuY3JlYXRlRWwoXCJsaVwiLCB7XG4gICAgICAgICAgY2xzOiBcInNlYXJjaC1yZXN1bHQtZmlsZS10aXRsZSBpcy1jbGlja2FibGVcIixcbiAgICAgICAgICB0aXRsZTogbmVhcmVzdFtpXS5saW5rLFxuICAgICAgICB9KTtcbiAgICAgICAgaWYobmVhcmVzdFtpXS5saW5rLmluZGV4T2YoXCIjXCIpID4gLTEpeyAvLyBpcyBibG9ja1xuICAgICAgICAgIE9ic2lkaWFuLk1hcmtkb3duUmVuZGVyZXIucmVuZGVyTWFya2Rvd24oKGF3YWl0IHRoaXMuYmxvY2tfcmV0cmlldmVyKG5lYXJlc3RbaV0ubGluaywge2xpbmVzOiAxMCwgbWF4X2NoYXJzOiAxMDAwfSkpLCBjb250ZW50c19jb250YWluZXIsIG5lYXJlc3RbaV0ubGluaywgbmV3IE9ic2lkaWFuLkNvbXBvbmVudCgpKTtcbiAgICAgICAgfWVsc2V7IC8vIGlzIGZpbGVcbiAgICAgICAgICBjb25zdCBmaXJzdF90ZW5fbGluZXMgPSBhd2FpdCB0aGlzLmZpbGVfcmV0cmlldmVyKG5lYXJlc3RbaV0ubGluaywge2xpbmVzOiAxMCwgbWF4X2NoYXJzOiAxMDAwfSk7XG4gICAgICAgICAgaWYoIWZpcnN0X3Rlbl9saW5lcykgY29udGludWU7IC8vIHNraXAgaWYgZmlsZSBpcyBlbXB0eVxuICAgICAgICAgIE9ic2lkaWFuLk1hcmtkb3duUmVuZGVyZXIucmVuZGVyTWFya2Rvd24oZmlyc3RfdGVuX2xpbmVzLCBjb250ZW50c19jb250YWluZXIsIG5lYXJlc3RbaV0ubGluaywgbmV3IE9ic2lkaWFuLkNvbXBvbmVudCgpKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmFkZF9saW5rX2xpc3RlbmVycyhjb250ZW50cywgbmVhcmVzdFtpXSwgaXRlbSk7XG4gICAgICB9XG4gICAgICB0aGlzLnJlbmRlcl9icmFuZChjb250YWluZXIsIFwiYmxvY2tcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gZ3JvdXAgbmVhcmVzdCBieSBmaWxlXG4gICAgY29uc3QgbmVhcmVzdF9ieV9maWxlID0ge307XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBuZWFyZXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgICBjb25zdCBjdXJyID0gbmVhcmVzdFtpXTtcbiAgICAgIGNvbnN0IGxpbmsgPSBjdXJyLmxpbms7XG4gICAgICAvLyBza2lwIGlmIGxpbmsgaXMgYW4gb2JqZWN0IChpbmRpY2F0ZXMgZXh0ZXJuYWwgbG9naWMpXG4gICAgICBpZiAodHlwZW9mIGxpbmsgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgbmVhcmVzdF9ieV9maWxlW2xpbmsucGF0aF0gPSBbY3Vycl07XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGxpbmsuaW5kZXhPZihcIiNcIikgPiAtMSkge1xuICAgICAgICBjb25zdCBmaWxlX3BhdGggPSBsaW5rLnNwbGl0KFwiI1wiKVswXTtcbiAgICAgICAgaWYgKCFuZWFyZXN0X2J5X2ZpbGVbZmlsZV9wYXRoXSkge1xuICAgICAgICAgIG5lYXJlc3RfYnlfZmlsZVtmaWxlX3BhdGhdID0gW107XG4gICAgICAgIH1cbiAgICAgICAgbmVhcmVzdF9ieV9maWxlW2ZpbGVfcGF0aF0ucHVzaChuZWFyZXN0W2ldKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmICghbmVhcmVzdF9ieV9maWxlW2xpbmtdKSB7XG4gICAgICAgICAgbmVhcmVzdF9ieV9maWxlW2xpbmtdID0gW107XG4gICAgICAgIH1cbiAgICAgICAgLy8gYWx3YXlzIGFkZCB0byBmcm9udCBvZiBhcnJheVxuICAgICAgICBuZWFyZXN0X2J5X2ZpbGVbbGlua10udW5zaGlmdChuZWFyZXN0W2ldKTtcbiAgICAgIH1cbiAgICB9XG4gICAgLy8gZm9yIGVhY2ggZmlsZVxuICAgIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyhuZWFyZXN0X2J5X2ZpbGUpO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwga2V5cy5sZW5ndGg7IGkrKykge1xuICAgICAgY29uc3QgZmlsZSA9IG5lYXJlc3RfYnlfZmlsZVtrZXlzW2ldXTtcbiAgICAgIC8qKlxuICAgICAgICogQmVnaW4gZXh0ZXJuYWwgbGluayBoYW5kbGluZ1xuICAgICAgICovXG4gICAgICAvLyBpZiBsaW5rIGlzIGFuIG9iamVjdCAoaW5kaWNhdGVzIHYyIGxvZ2ljKVxuICAgICAgaWYgKHR5cGVvZiBmaWxlWzBdLmxpbmsgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgY29uc3QgY3VyciA9IGZpbGVbMF07XG4gICAgICAgIGNvbnN0IG1ldGEgPSBjdXJyLmxpbms7XG4gICAgICAgIGlmIChtZXRhLnBhdGguc3RhcnRzV2l0aChcImh0dHBcIikpIHtcbiAgICAgICAgICBjb25zdCBpdGVtID0gbGlzdC5jcmVhdGVFbChcImRpdlwiLCB7IGNsczogXCJzZWFyY2gtcmVzdWx0XCIgfSk7XG4gICAgICAgICAgY29uc3QgbGluayA9IGl0ZW0uY3JlYXRlRWwoXCJhXCIsIHtcbiAgICAgICAgICAgIGNsczogXCJzZWFyY2gtcmVzdWx0LWZpbGUtdGl0bGUgaXMtY2xpY2thYmxlXCIsXG4gICAgICAgICAgICBocmVmOiBtZXRhLnBhdGgsXG4gICAgICAgICAgICB0aXRsZTogbWV0YS50aXRsZSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBsaW5rLmlubmVySFRNTCA9IHRoaXMucmVuZGVyX2V4dGVybmFsX2xpbmtfZWxtKG1ldGEpO1xuICAgICAgICAgIGl0ZW0uc2V0QXR0cignZHJhZ2dhYmxlJywgJ3RydWUnKTtcbiAgICAgICAgICBjb250aW51ZTsgLy8gZW5kcyBoZXJlIGZvciBleHRlcm5hbCBsaW5rc1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICAvKipcbiAgICAgICAqIEhhbmRsZXMgSW50ZXJuYWxcbiAgICAgICAqL1xuICAgICAgbGV0IGZpbGVfbGlua190ZXh0O1xuICAgICAgY29uc3QgZmlsZV9zaW1pbGFyaXR5X3BjdCA9IE1hdGgucm91bmQoZmlsZVswXS5zaW1pbGFyaXR5ICogMTAwKSArIFwiJVwiO1xuICAgICAgaWYgKHRoaXMuc2V0dGluZ3Muc2hvd19mdWxsX3BhdGgpIHtcbiAgICAgICAgY29uc3QgcGNzID0gZmlsZVswXS5saW5rLnNwbGl0KFwiL1wiKTtcbiAgICAgICAgZmlsZV9saW5rX3RleHQgPSBwY3NbcGNzLmxlbmd0aCAtIDFdO1xuICAgICAgICBjb25zdCBwYXRoID0gcGNzLnNsaWNlKDAsIHBjcy5sZW5ndGggLSAxKS5qb2luKFwiL1wiKTtcbiAgICAgICAgZmlsZV9saW5rX3RleHQgPSBgPHNtYWxsPiR7cGF0aH0gfCAke2ZpbGVfc2ltaWxhcml0eV9wY3R9PC9zbWFsbD48YnI+JHtmaWxlX2xpbmtfdGV4dH1gO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZmlsZV9saW5rX3RleHQgPSBmaWxlWzBdLmxpbmsuc3BsaXQoXCIvXCIpLnBvcCgpO1xuICAgICAgICAvLyBhZGQgc2ltaWxhcml0eSBwZXJjZW50YWdlXG4gICAgICAgIGZpbGVfbGlua190ZXh0ICs9ICcgfCAnICsgZmlsZV9zaW1pbGFyaXR5X3BjdDtcbiAgICAgIH1cblxuXG4gICAgICAgIFxuICAgICAgLy8gc2tpcCBjb250ZW50cyByZW5kZXJpbmcgaWYgaW5jb21wYXRpYmxlIGZpbGUgdHlwZVxuICAgICAgLy8gZXguIG5vdCBtYXJrZG93biBvciBjb250YWlucyAnLmV4Y2FsaWRyYXcnXG4gICAgICBpZighdGhpcy5yZW5kZXJhYmxlX2ZpbGVfdHlwZShmaWxlWzBdLmxpbmspKSB7XG4gICAgICAgIGNvbnN0IGl0ZW0gPSBsaXN0LmNyZWF0ZUVsKFwiZGl2XCIsIHsgY2xzOiBcInNlYXJjaC1yZXN1bHRcIiB9KTtcbiAgICAgICAgY29uc3QgZmlsZV9saW5rID0gaXRlbS5jcmVhdGVFbChcImFcIiwge1xuICAgICAgICAgIGNsczogXCJzZWFyY2gtcmVzdWx0LWZpbGUtdGl0bGUgaXMtY2xpY2thYmxlXCIsXG4gICAgICAgICAgdGl0bGU6IGZpbGVbMF0ubGluayxcbiAgICAgICAgfSk7XG4gICAgICAgIGZpbGVfbGluay5pbm5lckhUTUwgPSBmaWxlX2xpbmtfdGV4dDtcbiAgICAgICAgLy8gYWRkIGxpbmsgbGlzdGVuZXJzIHRvIGZpbGUgbGlua1xuICAgICAgICB0aGlzLmFkZF9saW5rX2xpc3RlbmVycyhmaWxlX2xpbmssIGZpbGVbMF0sIGl0ZW0pO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuXG4gICAgICAvLyByZW1vdmUgZmlsZSBleHRlbnNpb24gaWYgLm1kXG4gICAgICBmaWxlX2xpbmtfdGV4dCA9IGZpbGVfbGlua190ZXh0LnJlcGxhY2UoXCIubWRcIiwgXCJcIikucmVwbGFjZSgvIy9nLCBcIiA+IFwiKTtcbiAgICAgIGNvbnN0IGl0ZW0gPSBsaXN0LmNyZWF0ZUVsKFwiZGl2XCIsIHsgY2xzOiBzZWFyY2hfcmVzdWx0X2NsYXNzIH0pO1xuICAgICAgY29uc3QgdG9nZ2xlID0gaXRlbS5jcmVhdGVFbChcInNwYW5cIiwgeyBjbHM6IFwiaXMtY2xpY2thYmxlXCIgfSk7XG4gICAgICAvLyBpbnNlcnQgcmlnaHQgdHJpYW5nbGUgc3ZnIGljb24gYXMgdG9nZ2xlIGJ1dHRvbiBpbiBzcGFuXG4gICAgICBPYnNpZGlhbi5zZXRJY29uKHRvZ2dsZSwgXCJyaWdodC10cmlhbmdsZVwiKTsgLy8gbXVzdCBjb21lIGJlZm9yZSBhZGRpbmcgb3RoZXIgZWxtcyBlbHNlIG92ZXJ3cml0ZXNcbiAgICAgIGNvbnN0IGZpbGVfbGluayA9IHRvZ2dsZS5jcmVhdGVFbChcImFcIiwge1xuICAgICAgICBjbHM6IFwic2VhcmNoLXJlc3VsdC1maWxlLXRpdGxlXCIsXG4gICAgICAgIHRpdGxlOiBmaWxlWzBdLmxpbmssXG4gICAgICB9KTtcbiAgICAgIGZpbGVfbGluay5pbm5lckhUTUwgPSBmaWxlX2xpbmtfdGV4dDtcbiAgICAgIC8vIGFkZCBsaW5rIGxpc3RlbmVycyB0byBmaWxlIGxpbmtcbiAgICAgIHRoaXMuYWRkX2xpbmtfbGlzdGVuZXJzKGZpbGVfbGluaywgZmlsZVswXSwgdG9nZ2xlKTtcbiAgICAgIHRvZ2dsZS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiB7XG4gICAgICAgIC8vIGZpbmQgcGFyZW50IGNvbnRhaW5pbmcgY2xhc3Mgc2VhcmNoLXJlc3VsdFxuICAgICAgICBsZXQgcGFyZW50ID0gZXZlbnQudGFyZ2V0O1xuICAgICAgICB3aGlsZSAoIXBhcmVudC5jbGFzc0xpc3QuY29udGFpbnMoXCJzZWFyY2gtcmVzdWx0XCIpKSB7XG4gICAgICAgICAgcGFyZW50ID0gcGFyZW50LnBhcmVudEVsZW1lbnQ7XG4gICAgICAgIH1cbiAgICAgICAgcGFyZW50LmNsYXNzTGlzdC50b2dnbGUoXCJzYy1jb2xsYXBzZWRcIik7XG4gICAgICAgIC8vIFRPRE86IGlmIGJsb2NrIGNvbnRhaW5lciBpcyBlbXB0eSwgcmVuZGVyIG1hcmtkb3duIGZyb20gYmxvY2sgcmV0cmlldmVyXG4gICAgICB9KTtcbiAgICAgIGNvbnN0IGZpbGVfbGlua19saXN0ID0gaXRlbS5jcmVhdGVFbChcInVsXCIpO1xuICAgICAgLy8gZm9yIGVhY2ggbGluayBpbiBmaWxlXG4gICAgICBmb3IgKGxldCBqID0gMDsgaiA8IGZpbGUubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgLy8gaWYgaXMgYSBibG9jayAoaGFzICMgaW4gbGluaylcbiAgICAgICAgaWYoZmlsZVtqXS5saW5rLmluZGV4T2YoXCIjXCIpID4gLTEpIHtcbiAgICAgICAgICBjb25zdCBibG9jayA9IGZpbGVbal07XG4gICAgICAgICAgY29uc3QgYmxvY2tfbGluayA9IGZpbGVfbGlua19saXN0LmNyZWF0ZUVsKFwibGlcIiwge1xuICAgICAgICAgICAgY2xzOiBcInNlYXJjaC1yZXN1bHQtZmlsZS10aXRsZSBpcy1jbGlja2FibGVcIixcbiAgICAgICAgICAgIHRpdGxlOiBibG9jay5saW5rLFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIC8vIHNraXAgYmxvY2sgY29udGV4dCBpZiBmaWxlLmxlbmd0aCA9PT0gMSBiZWNhdXNlIGFscmVhZHkgYWRkZWRcbiAgICAgICAgICBpZihmaWxlLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICAgIGNvbnN0IGJsb2NrX2NvbnRleHQgPSB0aGlzLnJlbmRlcl9ibG9ja19jb250ZXh0KGJsb2NrKTtcbiAgICAgICAgICAgIGNvbnN0IGJsb2NrX3NpbWlsYXJpdHlfcGN0ID0gTWF0aC5yb3VuZChibG9jay5zaW1pbGFyaXR5ICogMTAwKSArIFwiJVwiO1xuICAgICAgICAgICAgYmxvY2tfbGluay5pbm5lckhUTUwgPSBgPHNtYWxsPiR7YmxvY2tfY29udGV4dH0gfCAke2Jsb2NrX3NpbWlsYXJpdHlfcGN0fTwvc21hbGw+YDtcbiAgICAgICAgICB9XG4gICAgICAgICAgY29uc3QgYmxvY2tfY29udGFpbmVyID0gYmxvY2tfbGluay5jcmVhdGVFbChcImRpdlwiKTtcbiAgICAgICAgICAvLyBUT0RPOiBtb3ZlIHRvIHJlbmRlcmluZyBvbiBleHBhbmRpbmcgc2VjdGlvbiAodG9nZ2xlIGNvbGxhcHNlZClcbiAgICAgICAgICBPYnNpZGlhbi5NYXJrZG93blJlbmRlcmVyLnJlbmRlck1hcmtkb3duKChhd2FpdCB0aGlzLmJsb2NrX3JldHJpZXZlcihibG9jay5saW5rLCB7bGluZXM6IDEwLCBtYXhfY2hhcnM6IDEwMDB9KSksIGJsb2NrX2NvbnRhaW5lciwgYmxvY2subGluaywgbmV3IE9ic2lkaWFuLkNvbXBvbmVudCgpKTtcbiAgICAgICAgICAvLyBhZGQgbGluayBsaXN0ZW5lcnMgdG8gYmxvY2sgbGlua1xuICAgICAgICAgIHRoaXMuYWRkX2xpbmtfbGlzdGVuZXJzKGJsb2NrX2xpbmssIGJsb2NrLCBmaWxlX2xpbmtfbGlzdCk7XG4gICAgICAgIH1lbHNle1xuICAgICAgICAgIC8vIGdldCBmaXJzdCB0ZW4gbGluZXMgb2YgZmlsZVxuICAgICAgICAgIGNvbnN0IGZpbGVfbGlua19saXN0ID0gaXRlbS5jcmVhdGVFbChcInVsXCIpO1xuICAgICAgICAgIGNvbnN0IGJsb2NrX2xpbmsgPSBmaWxlX2xpbmtfbGlzdC5jcmVhdGVFbChcImxpXCIsIHtcbiAgICAgICAgICAgIGNsczogXCJzZWFyY2gtcmVzdWx0LWZpbGUtdGl0bGUgaXMtY2xpY2thYmxlXCIsXG4gICAgICAgICAgICB0aXRsZTogZmlsZVswXS5saW5rLFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGNvbnN0IGJsb2NrX2NvbnRhaW5lciA9IGJsb2NrX2xpbmsuY3JlYXRlRWwoXCJkaXZcIik7XG4gICAgICAgICAgbGV0IGZpcnN0X3Rlbl9saW5lcyA9IGF3YWl0IHRoaXMuZmlsZV9yZXRyaWV2ZXIoZmlsZVswXS5saW5rLCB7bGluZXM6IDEwLCBtYXhfY2hhcnM6IDEwMDB9KTtcbiAgICAgICAgICBpZighZmlyc3RfdGVuX2xpbmVzKSBjb250aW51ZTsgLy8gaWYgZmlsZSBub3QgZm91bmQsIHNraXBcbiAgICAgICAgICBPYnNpZGlhbi5NYXJrZG93blJlbmRlcmVyLnJlbmRlck1hcmtkb3duKGZpcnN0X3Rlbl9saW5lcywgYmxvY2tfY29udGFpbmVyLCBmaWxlWzBdLmxpbmssIG5ldyBPYnNpZGlhbi5Db21wb25lbnQoKSk7XG4gICAgICAgICAgdGhpcy5hZGRfbGlua19saXN0ZW5lcnMoYmxvY2tfbGluaywgZmlsZVswXSwgZmlsZV9saW5rX2xpc3QpO1xuXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5yZW5kZXJfYnJhbmQoY29udGFpbmVyLCBcImZpbGVcIik7XG4gIH1cblxuICBhZGRfbGlua19saXN0ZW5lcnMoaXRlbSwgY3VyciwgbGlzdCkge1xuICAgIGl0ZW0uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGFzeW5jIChldmVudCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5vcGVuX25vdGUoY3VyciwgZXZlbnQpO1xuICAgIH0pO1xuICAgIC8vIGRyYWctb25cbiAgICAvLyBjdXJyZW50bHkgb25seSB3b3JrcyB3aXRoIGZ1bGwtZmlsZSBsaW5rc1xuICAgIGl0ZW0uc2V0QXR0cignZHJhZ2dhYmxlJywgJ3RydWUnKTtcbiAgICBpdGVtLmFkZEV2ZW50TGlzdGVuZXIoJ2RyYWdzdGFydCcsIChldmVudCkgPT4ge1xuICAgICAgY29uc3QgZHJhZ01hbmFnZXIgPSB0aGlzLmFwcC5kcmFnTWFuYWdlcjtcbiAgICAgIGNvbnN0IGZpbGVfcGF0aCA9IGN1cnIubGluay5zcGxpdChcIiNcIilbMF07XG4gICAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaXJzdExpbmtwYXRoRGVzdChmaWxlX3BhdGgsICcnKTtcbiAgICAgIGNvbnN0IGRyYWdEYXRhID0gZHJhZ01hbmFnZXIuZHJhZ0ZpbGUoZXZlbnQsIGZpbGUpO1xuICAgICAgLy8gY29uc29sZS5sb2coZHJhZ0RhdGEpO1xuICAgICAgZHJhZ01hbmFnZXIub25EcmFnU3RhcnQoZXZlbnQsIGRyYWdEYXRhKTtcbiAgICB9KTtcbiAgICAvLyBpZiBjdXJyLmxpbmsgY29udGFpbnMgY3VybHkgYnJhY2VzLCByZXR1cm4gKGluY29tcGF0aWJsZSB3aXRoIGhvdmVyLWxpbmspXG4gICAgaWYgKGN1cnIubGluay5pbmRleE9mKFwie1wiKSA+IC0xKSByZXR1cm47XG4gICAgLy8gdHJpZ2dlciBob3ZlciBldmVudCBvbiBsaW5rXG4gICAgaXRlbS5hZGRFdmVudExpc3RlbmVyKFwibW91c2VvdmVyXCIsIChldmVudCkgPT4ge1xuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLnRyaWdnZXIoXCJob3Zlci1saW5rXCIsIHtcbiAgICAgICAgZXZlbnQsXG4gICAgICAgIHNvdXJjZTogU01BUlRfQ09OTkVDVElPTlNfVklFV19UWVBFLFxuICAgICAgICBob3ZlclBhcmVudDogbGlzdCxcbiAgICAgICAgdGFyZ2V0RWw6IGl0ZW0sXG4gICAgICAgIGxpbmt0ZXh0OiBjdXJyLmxpbmssXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIGdldCB0YXJnZXQgZmlsZSBmcm9tIGxpbmsgcGF0aFxuICAvLyBpZiBzdWItc2VjdGlvbiBpcyBsaW5rZWQsIG9wZW4gZmlsZSBhbmQgc2Nyb2xsIHRvIHN1Yi1zZWN0aW9uXG4gIGFzeW5jIG9wZW5fbm90ZShjdXJyLCBldmVudD1udWxsKSB7XG4gICAgbGV0IHRhcmdldEZpbGU7XG4gICAgbGV0IGhlYWRpbmc7XG4gICAgaWYgKGN1cnIubGluay5pbmRleE9mKFwiI1wiKSA+IC0xKSB7XG4gICAgICAvLyByZW1vdmUgYWZ0ZXIgIyBmcm9tIGxpbmtcbiAgICAgIHRhcmdldEZpbGUgPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpcnN0TGlua3BhdGhEZXN0KGN1cnIubGluay5zcGxpdChcIiNcIilbMF0sIFwiXCIpO1xuICAgICAgLy8gY29uc29sZS5sb2codGFyZ2V0RmlsZSk7XG4gICAgICBjb25zdCB0YXJnZXRfZmlsZV9jYWNoZSA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKHRhcmdldEZpbGUpO1xuICAgICAgLy8gY29uc29sZS5sb2codGFyZ2V0X2ZpbGVfY2FjaGUpO1xuICAgICAgLy8gZ2V0IGhlYWRpbmdcbiAgICAgIGxldCBoZWFkaW5nX3RleHQgPSBjdXJyLmxpbmsuc3BsaXQoXCIjXCIpLnBvcCgpO1xuICAgICAgLy8gaWYgaGVhZGluZyB0ZXh0IGNvbnRhaW5zIGEgY3VybHkgYnJhY2UsIGdldCB0aGUgbnVtYmVyIGluc2lkZSB0aGUgY3VybHkgYnJhY2VzIGFzIG9jY3VyZW5jZVxuICAgICAgbGV0IG9jY3VyZW5jZSA9IDA7XG4gICAgICBpZiAoaGVhZGluZ190ZXh0LmluZGV4T2YoXCJ7XCIpID4gLTEpIHtcbiAgICAgICAgLy8gZ2V0IG9jY3VyZW5jZVxuICAgICAgICBvY2N1cmVuY2UgPSBwYXJzZUludChoZWFkaW5nX3RleHQuc3BsaXQoXCJ7XCIpWzFdLnNwbGl0KFwifVwiKVswXSk7XG4gICAgICAgIC8vIHJlbW92ZSBvY2N1cmVuY2UgZnJvbSBoZWFkaW5nIHRleHRcbiAgICAgICAgaGVhZGluZ190ZXh0ID0gaGVhZGluZ190ZXh0LnNwbGl0KFwie1wiKVswXTtcbiAgICAgIH1cbiAgICAgIC8vIGdldCBoZWFkaW5ncyBmcm9tIGZpbGUgY2FjaGVcbiAgICAgIGNvbnN0IGhlYWRpbmdzID0gdGFyZ2V0X2ZpbGVfY2FjaGUuaGVhZGluZ3M7XG4gICAgICAvLyBnZXQgaGVhZGluZ3Mgd2l0aCB0aGUgc2FtZSBkZXB0aCBhbmQgdGV4dCBhcyB0aGUgbGlua1xuICAgICAgZm9yKGxldCBpID0gMDsgaSA8IGhlYWRpbmdzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGlmIChoZWFkaW5nc1tpXS5oZWFkaW5nID09PSBoZWFkaW5nX3RleHQpIHtcbiAgICAgICAgICAvLyBpZiBvY2N1cmVuY2UgaXMgMCwgc2V0IGhlYWRpbmcgYW5kIGJyZWFrXG4gICAgICAgICAgaWYob2NjdXJlbmNlID09PSAwKSB7XG4gICAgICAgICAgICBoZWFkaW5nID0gaGVhZGluZ3NbaV07XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgb2NjdXJlbmNlLS07IC8vIGRlY3JlbWVudCBvY2N1cmVuY2VcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgLy8gY29uc29sZS5sb2coaGVhZGluZyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRhcmdldEZpbGUgPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpcnN0TGlua3BhdGhEZXN0KGN1cnIubGluaywgXCJcIik7XG4gICAgfVxuICAgIGxldCBsZWFmO1xuICAgIGlmKGV2ZW50KSB7XG4gICAgICAvLyBwcm9wZXJseSBoYW5kbGUgaWYgdGhlIG1ldGEvY3RybCBrZXkgaXMgcHJlc3NlZFxuICAgICAgY29uc3QgbW9kID0gT2JzaWRpYW4uS2V5bWFwLmlzTW9kRXZlbnQoZXZlbnQpO1xuICAgICAgLy8gZ2V0IG1vc3QgcmVjZW50IGxlYWZcbiAgICAgIGxlYWYgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0TGVhZihtb2QpO1xuICAgIH1lbHNle1xuICAgICAgLy8gZ2V0IG1vc3QgcmVjZW50IGxlYWZcbiAgICAgIGxlYWYgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0TW9zdFJlY2VudExlYWYoKTtcbiAgICB9XG4gICAgYXdhaXQgbGVhZi5vcGVuRmlsZSh0YXJnZXRGaWxlKTtcbiAgICBpZiAoaGVhZGluZykge1xuICAgICAgbGV0IHsgZWRpdG9yIH0gPSBsZWFmLnZpZXc7XG4gICAgICBjb25zdCBwb3MgPSB7IGxpbmU6IGhlYWRpbmcucG9zaXRpb24uc3RhcnQubGluZSwgY2g6IDAgfTtcbiAgICAgIGVkaXRvci5zZXRDdXJzb3IocG9zKTtcbiAgICAgIGVkaXRvci5zY3JvbGxJbnRvVmlldyh7IHRvOiBwb3MsIGZyb206IHBvcyB9LCB0cnVlKTtcbiAgICB9XG4gIH1cblxuICByZW5kZXJfYmxvY2tfY29udGV4dChibG9jaykge1xuICAgIGNvbnN0IGJsb2NrX2hlYWRpbmdzID0gYmxvY2subGluay5zcGxpdChcIi5tZFwiKVsxXS5zcGxpdChcIiNcIik7XG4gICAgLy8gc3RhcnRpbmcgd2l0aCB0aGUgbGFzdCBoZWFkaW5nIGZpcnN0LCBpdGVyYXRlIHRocm91Z2ggaGVhZGluZ3NcbiAgICBsZXQgYmxvY2tfY29udGV4dCA9IFwiXCI7XG4gICAgZm9yIChsZXQgaSA9IGJsb2NrX2hlYWRpbmdzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICBpZihibG9ja19jb250ZXh0Lmxlbmd0aCA+IDApIHtcbiAgICAgICAgYmxvY2tfY29udGV4dCA9IGAgPiAke2Jsb2NrX2NvbnRleHR9YDtcbiAgICAgIH1cbiAgICAgIGJsb2NrX2NvbnRleHQgPSBibG9ja19oZWFkaW5nc1tpXSArIGJsb2NrX2NvbnRleHQ7XG4gICAgICAvLyBpZiBibG9jayBjb250ZXh0IGlzIGxvbmdlciB0aGFuIE4gY2hhcmFjdGVycywgYnJlYWtcbiAgICAgIGlmIChibG9ja19jb250ZXh0Lmxlbmd0aCA+IDEwMCkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gICAgLy8gcmVtb3ZlIGxlYWRpbmcgPiBpZiBleGlzdHNcbiAgICBpZiAoYmxvY2tfY29udGV4dC5zdGFydHNXaXRoKFwiID4gXCIpKSB7XG4gICAgICBibG9ja19jb250ZXh0ID0gYmxvY2tfY29udGV4dC5zbGljZSgzKTtcbiAgICB9XG4gICAgcmV0dXJuIGJsb2NrX2NvbnRleHQ7XG5cbiAgfVxuXG4gIHJlbmRlcmFibGVfZmlsZV90eXBlKGxpbmspIHtcbiAgICByZXR1cm4gKGxpbmsuaW5kZXhPZihcIi5tZFwiKSAhPT0gLTEpICYmIChsaW5rLmluZGV4T2YoXCIuZXhjYWxpZHJhd1wiKSA9PT0gLTEpO1xuICB9XG5cbiAgcmVuZGVyX2V4dGVybmFsX2xpbmtfZWxtKG1ldGEpe1xuICAgIGlmKG1ldGEuc291cmNlKSB7XG4gICAgICBpZihtZXRhLnNvdXJjZSA9PT0gXCJHbWFpbFwiKSBtZXRhLnNvdXJjZSA9IFwiXHVEODNEXHVEQ0U3IEdtYWlsXCI7XG4gICAgICByZXR1cm4gYDxzbWFsbD4ke21ldGEuc291cmNlfTwvc21hbGw+PGJyPiR7bWV0YS50aXRsZX1gO1xuICAgIH1cbiAgICAvLyByZW1vdmUgaHR0cChzKTovL1xuICAgIGxldCBkb21haW4gPSBtZXRhLnBhdGgucmVwbGFjZSgvKF5cXHcrOnxeKVxcL1xcLy8sIFwiXCIpO1xuICAgIC8vIHNlcGFyYXRlIGRvbWFpbiBmcm9tIHBhdGhcbiAgICBkb21haW4gPSBkb21haW4uc3BsaXQoXCIvXCIpWzBdO1xuICAgIC8vIHdyYXAgZG9tYWluIGluIDxzbWFsbD4gYW5kIGFkZCBsaW5lIGJyZWFrXG4gICAgcmV0dXJuIGA8c21hbGw+XHVEODNDXHVERjEwICR7ZG9tYWlufTwvc21hbGw+PGJyPiR7bWV0YS50aXRsZX1gO1xuICB9XG4gIC8vIGdldCBhbGwgZm9sZGVyc1xuICBhc3luYyBnZXRfYWxsX2ZvbGRlcnMoKSB7XG4gICAgaWYoIXRoaXMuZm9sZGVycyB8fCB0aGlzLmZvbGRlcnMubGVuZ3RoID09PSAwKXtcbiAgICAgIHRoaXMuZm9sZGVycyA9IGF3YWl0IHRoaXMuZ2V0X2ZvbGRlcnMoKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuZm9sZGVycztcbiAgfVxuICAvLyBnZXQgZm9sZGVycywgdHJhdmVyc2Ugbm9uLWhpZGRlbiBzdWItZm9sZGVyc1xuICBhc3luYyBnZXRfZm9sZGVycyhwYXRoID0gXCIvXCIpIHtcbiAgICBsZXQgZm9sZGVycyA9IChhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLmxpc3QocGF0aCkpLmZvbGRlcnM7XG4gICAgbGV0IGZvbGRlcl9saXN0ID0gW107XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBmb2xkZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoZm9sZGVyc1tpXS5zdGFydHNXaXRoKFwiLlwiKSkgY29udGludWU7XG4gICAgICBmb2xkZXJfbGlzdC5wdXNoKGZvbGRlcnNbaV0pO1xuICAgICAgZm9sZGVyX2xpc3QgPSBmb2xkZXJfbGlzdC5jb25jYXQoYXdhaXQgdGhpcy5nZXRfZm9sZGVycyhmb2xkZXJzW2ldICsgXCIvXCIpKTtcbiAgICB9XG4gICAgcmV0dXJuIGZvbGRlcl9saXN0O1xuICB9XG5cblxuICBhc3luYyBzeW5jX25vdGVzKCkge1xuICAgIC8vIGlmIGxpY2Vuc2Uga2V5IGlzIG5vdCBzZXQsIHJldHVyblxuICAgIGlmKCF0aGlzLnNldHRpbmdzLmxpY2Vuc2Vfa2V5KXtcbiAgICAgIG5ldyBPYnNpZGlhbi5Ob3RpY2UoXCJTbWFydCBDb25uZWN0aW9uczogU3VwcG9ydGVyIGxpY2Vuc2Uga2V5IGlzIHJlcXVpcmVkIHRvIHN5bmMgbm90ZXMgdG8gdGhlIENoYXRHUFQgUGx1Z2luIHNlcnZlci5cIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnNvbGUubG9nKFwic3luY2luZyBub3Rlc1wiKTtcbiAgICAvLyBnZXQgYWxsIGZpbGVzIGluIHZhdWx0XG4gICAgY29uc3QgZmlsZXMgPSB0aGlzLmFwcC52YXVsdC5nZXRNYXJrZG93bkZpbGVzKCkuZmlsdGVyKChmaWxlKSA9PiB7XG4gICAgICAvLyBmaWx0ZXIgb3V0IGZpbGUgcGF0aHMgbWF0Y2hpbmcgYW55IHN0cmluZ3MgaW4gdGhpcy5maWxlX2V4Y2x1c2lvbnNcbiAgICAgIGZvcihsZXQgaSA9IDA7IGkgPCB0aGlzLmZpbGVfZXhjbHVzaW9ucy5sZW5ndGg7IGkrKykge1xuICAgICAgICBpZihmaWxlLnBhdGguaW5kZXhPZih0aGlzLmZpbGVfZXhjbHVzaW9uc1tpXSkgPiAtMSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSk7XG4gICAgY29uc3Qgbm90ZXMgPSBhd2FpdCB0aGlzLmJ1aWxkX25vdGVzX29iamVjdChmaWxlcyk7XG4gICAgY29uc29sZS5sb2coXCJvYmplY3QgYnVpbHRcIik7XG4gICAgLy8gc2F2ZSBub3RlcyBvYmplY3QgdG8gLnNtYXJ0LWNvbm5lY3Rpb25zL25vdGVzLmpzb25cbiAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLndyaXRlKFwiLnNtYXJ0LWNvbm5lY3Rpb25zL25vdGVzLmpzb25cIiwgSlNPTi5zdHJpbmdpZnkobm90ZXMsIG51bGwsIDIpKTtcbiAgICBjb25zb2xlLmxvZyhcIm5vdGVzIHNhdmVkXCIpO1xuICAgIGNvbnNvbGUubG9nKHRoaXMuc2V0dGluZ3MubGljZW5zZV9rZXkpO1xuICAgIC8vIFBPU1Qgbm90ZXMgb2JqZWN0IHRvIHNlcnZlclxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgKDAsIE9ic2lkaWFuLnJlcXVlc3RVcmwpKHtcbiAgICAgIHVybDogXCJodHRwczovL3N5bmMuc21hcnRjb25uZWN0aW9ucy5hcHAvc3luY1wiLFxuICAgICAgbWV0aG9kOiBcIlBPU1RcIixcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gICAgICB9LFxuICAgICAgY29udGVudFR5cGU6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBsaWNlbnNlX2tleTogdGhpcy5zZXR0aW5ncy5saWNlbnNlX2tleSxcbiAgICAgICAgbm90ZXM6IG5vdGVzXG4gICAgICB9KVxuICAgIH0pO1xuICAgIGNvbnNvbGUubG9nKHJlc3BvbnNlKTtcblxuICB9XG5cbiAgYXN5bmMgYnVpbGRfbm90ZXNfb2JqZWN0KGZpbGVzKSB7XG4gICAgbGV0IG91dHB1dCA9IHt9O1xuICBcbiAgICBmb3IobGV0IGkgPSAwOyBpIDwgZmlsZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGxldCBmaWxlID0gZmlsZXNbaV07XG4gICAgICBsZXQgcGFydHMgPSBmaWxlLnBhdGguc3BsaXQoXCIvXCIpO1xuICAgICAgbGV0IGN1cnJlbnQgPSBvdXRwdXQ7XG4gIFxuICAgICAgZm9yIChsZXQgaWkgPSAwOyBpaSA8IHBhcnRzLmxlbmd0aDsgaWkrKykge1xuICAgICAgICBsZXQgcGFydCA9IHBhcnRzW2lpXTtcbiAgXG4gICAgICAgIGlmIChpaSA9PT0gcGFydHMubGVuZ3RoIC0gMSkge1xuICAgICAgICAgIC8vIFRoaXMgaXMgYSBmaWxlXG4gICAgICAgICAgY3VycmVudFtwYXJ0XSA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQoZmlsZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gVGhpcyBpcyBhIGRpcmVjdG9yeVxuICAgICAgICAgIGlmICghY3VycmVudFtwYXJ0XSkge1xuICAgICAgICAgICAgY3VycmVudFtwYXJ0XSA9IHt9O1xuICAgICAgICAgIH1cbiAgXG4gICAgICAgICAgY3VycmVudCA9IGN1cnJlbnRbcGFydF07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIFxuICAgIHJldHVybiBvdXRwdXQ7XG4gIH1cblxufVxuXG5jb25zdCBTTUFSVF9DT05ORUNUSU9OU19WSUVXX1RZUEUgPSBcInNtYXJ0LWNvbm5lY3Rpb25zLXZpZXdcIjtcbmNsYXNzIFNtYXJ0Q29ubmVjdGlvbnNWaWV3IGV4dGVuZHMgT2JzaWRpYW4uSXRlbVZpZXcge1xuICBjb25zdHJ1Y3RvcihsZWFmLCBwbHVnaW4pIHtcbiAgICBzdXBlcihsZWFmKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgICB0aGlzLm5lYXJlc3QgPSBudWxsO1xuICAgIHRoaXMubG9hZF93YWl0ID0gbnVsbDtcbiAgfVxuICBnZXRWaWV3VHlwZSgpIHtcbiAgICByZXR1cm4gU01BUlRfQ09OTkVDVElPTlNfVklFV19UWVBFO1xuICB9XG5cbiAgZ2V0RGlzcGxheVRleHQoKSB7XG4gICAgcmV0dXJuIFwiU21hcnQgQ29ubmVjdGlvbnMgRmlsZXNcIjtcbiAgfVxuXG4gIGdldEljb24oKSB7XG4gICAgcmV0dXJuIFwic21hcnQtY29ubmVjdGlvbnNcIjtcbiAgfVxuXG5cbiAgc2V0X21lc3NhZ2UobWVzc2FnZSkge1xuICAgIGNvbnN0IGNvbnRhaW5lciA9IHRoaXMuY29udGFpbmVyRWwuY2hpbGRyZW5bMV07XG4gICAgLy8gY2xlYXIgY29udGFpbmVyXG4gICAgY29udGFpbmVyLmVtcHR5KCk7XG4gICAgLy8gaW5pdGlhdGUgdG9wIGJhclxuICAgIHRoaXMuaW5pdGlhdGVfdG9wX2Jhcihjb250YWluZXIpO1xuICAgIC8vIGlmIG1lc2FnZSBpcyBhbiBhcnJheSwgbG9vcCB0aHJvdWdoIGFuZCBjcmVhdGUgYSBuZXcgcCBlbGVtZW50IGZvciBlYWNoIG1lc3NhZ2VcbiAgICBpZiAoQXJyYXkuaXNBcnJheShtZXNzYWdlKSkge1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBtZXNzYWdlLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGNvbnRhaW5lci5jcmVhdGVFbChcInBcIiwgeyBjbHM6IFwic2NfbWVzc2FnZVwiLCB0ZXh0OiBtZXNzYWdlW2ldIH0pO1xuICAgICAgfVxuICAgIH1lbHNle1xuICAgICAgLy8gY3JlYXRlIHAgZWxlbWVudCB3aXRoIG1lc3NhZ2VcbiAgICAgIGNvbnRhaW5lci5jcmVhdGVFbChcInBcIiwgeyBjbHM6IFwic2NfbWVzc2FnZVwiLCB0ZXh0OiBtZXNzYWdlIH0pO1xuICAgIH1cbiAgfVxuICByZW5kZXJfbGlua190ZXh0KGxpbmssIHNob3dfZnVsbF9wYXRoPWZhbHNlKSB7XG4gICAgLyoqXG4gICAgICogQmVnaW4gaW50ZXJuYWwgbGlua3NcbiAgICAgKi9cbiAgICAvLyBpZiBzaG93IGZ1bGwgcGF0aCBpcyBmYWxzZSwgcmVtb3ZlIGZpbGUgcGF0aFxuICAgIGlmICghc2hvd19mdWxsX3BhdGgpIHtcbiAgICAgIGxpbmsgPSBsaW5rLnNwbGl0KFwiL1wiKS5wb3AoKTtcbiAgICB9XG4gICAgLy8gaWYgY29udGFpbnMgJyMnXG4gICAgaWYgKGxpbmsuaW5kZXhPZihcIiNcIikgPiAtMSkge1xuICAgICAgLy8gc3BsaXQgYXQgLm1kXG4gICAgICBsaW5rID0gbGluay5zcGxpdChcIi5tZFwiKTtcbiAgICAgIC8vIHdyYXAgZmlyc3QgcGFydCBpbiA8c21hbGw+IGFuZCBhZGQgbGluZSBicmVha1xuICAgICAgbGlua1swXSA9IGA8c21hbGw+JHtsaW5rWzBdfTwvc21hbGw+PGJyPmA7XG4gICAgICAvLyBqb2luIGJhY2sgdG9nZXRoZXJcbiAgICAgIGxpbmsgPSBsaW5rLmpvaW4oXCJcIik7XG4gICAgICAvLyByZXBsYWNlICcjJyB3aXRoICcgXHUwMEJCICdcbiAgICAgIGxpbmsgPSBsaW5rLnJlcGxhY2UoL1xcIy9nLCBcIiBcdTAwQkIgXCIpO1xuICAgIH1lbHNle1xuICAgICAgLy8gcmVtb3ZlICcubWQnXG4gICAgICBsaW5rID0gbGluay5yZXBsYWNlKFwiLm1kXCIsIFwiXCIpO1xuICAgIH1cbiAgICByZXR1cm4gbGluaztcbiAgfVxuXG5cbiAgc2V0X25lYXJlc3QobmVhcmVzdCwgbmVhcmVzdF9jb250ZXh0PW51bGwsIHJlc3VsdHNfb25seT1mYWxzZSkge1xuICAgIC8vIGdldCBjb250YWluZXIgZWxlbWVudFxuICAgIGNvbnN0IGNvbnRhaW5lciA9IHRoaXMuY29udGFpbmVyRWwuY2hpbGRyZW5bMV07XG4gICAgLy8gaWYgcmVzdWx0cyBvbmx5IGlzIGZhbHNlLCBjbGVhciBjb250YWluZXIgYW5kIGluaXRpYXRlIHRvcCBiYXJcbiAgICBpZighcmVzdWx0c19vbmx5KXtcbiAgICAgIC8vIGNsZWFyIGNvbnRhaW5lclxuICAgICAgY29udGFpbmVyLmVtcHR5KCk7XG4gICAgICB0aGlzLmluaXRpYXRlX3RvcF9iYXIoY29udGFpbmVyLCBuZWFyZXN0X2NvbnRleHQpO1xuICAgIH1cbiAgICAvLyB1cGRhdGUgcmVzdWx0c1xuICAgIHRoaXMucGx1Z2luLnVwZGF0ZV9yZXN1bHRzKGNvbnRhaW5lciwgbmVhcmVzdCk7XG4gIH1cblxuICBpbml0aWF0ZV90b3BfYmFyKGNvbnRhaW5lciwgbmVhcmVzdF9jb250ZXh0PW51bGwpIHtcbiAgICBsZXQgdG9wX2JhcjtcbiAgICAvLyBpZiB0b3AgYmFyIGFscmVhZHkgZXhpc3RzLCBlbXB0eSBpdFxuICAgIGlmICgoY29udGFpbmVyLmNoaWxkcmVuLmxlbmd0aCA+IDApICYmIChjb250YWluZXIuY2hpbGRyZW5bMF0uY2xhc3NMaXN0LmNvbnRhaW5zKFwic2MtdG9wLWJhclwiKSkpIHtcbiAgICAgIHRvcF9iYXIgPSBjb250YWluZXIuY2hpbGRyZW5bMF07XG4gICAgICB0b3BfYmFyLmVtcHR5KCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIGluaXQgY29udGFpbmVyIGZvciB0b3AgYmFyXG4gICAgICB0b3BfYmFyID0gY29udGFpbmVyLmNyZWF0ZUVsKFwiZGl2XCIsIHsgY2xzOiBcInNjLXRvcC1iYXJcIiB9KTtcbiAgICB9XG4gICAgLy8gaWYgaGlnaGxpZ2h0ZWQgdGV4dCBpcyBub3QgbnVsbCwgY3JlYXRlIHAgZWxlbWVudCB3aXRoIGhpZ2hsaWdodGVkIHRleHRcbiAgICBpZiAobmVhcmVzdF9jb250ZXh0KSB7XG4gICAgICB0b3BfYmFyLmNyZWF0ZUVsKFwicFwiLCB7IGNsczogXCJzYy1jb250ZXh0XCIsIHRleHQ6IG5lYXJlc3RfY29udGV4dCB9KTtcbiAgICB9XG4gICAgLy8gYWRkIGNoYXQgYnV0dG9uXG4gICAgY29uc3QgY2hhdF9idXR0b24gPSB0b3BfYmFyLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgY2xzOiBcInNjLWNoYXQtYnV0dG9uXCIgfSk7XG4gICAgLy8gYWRkIGljb24gdG8gY2hhdCBidXR0b25cbiAgICBPYnNpZGlhbi5zZXRJY29uKGNoYXRfYnV0dG9uLCBcIm1lc3NhZ2Utc3F1YXJlXCIpO1xuICAgIC8vIGFkZCBjbGljayBsaXN0ZW5lciB0byBjaGF0IGJ1dHRvblxuICAgIGNoYXRfYnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgICAvLyBvcGVuIGNoYXRcbiAgICAgIHRoaXMucGx1Z2luLm9wZW5fY2hhdCgpO1xuICAgIH0pO1xuICAgIC8vIGFkZCBzZWFyY2ggYnV0dG9uXG4gICAgY29uc3Qgc2VhcmNoX2J1dHRvbiA9IHRvcF9iYXIuY3JlYXRlRWwoXCJidXR0b25cIiwgeyBjbHM6IFwic2Mtc2VhcmNoLWJ1dHRvblwiIH0pO1xuICAgIC8vIGFkZCBpY29uIHRvIHNlYXJjaCBidXR0b25cbiAgICBPYnNpZGlhbi5zZXRJY29uKHNlYXJjaF9idXR0b24sIFwic2VhcmNoXCIpO1xuICAgIC8vIGFkZCBjbGljayBsaXN0ZW5lciB0byBzZWFyY2ggYnV0dG9uXG4gICAgc2VhcmNoX2J1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgLy8gZW1wdHkgdG9wIGJhclxuICAgICAgdG9wX2Jhci5lbXB0eSgpO1xuICAgICAgLy8gY3JlYXRlIGlucHV0IGVsZW1lbnRcbiAgICAgIGNvbnN0IHNlYXJjaF9jb250YWluZXIgPSB0b3BfYmFyLmNyZWF0ZUVsKFwiZGl2XCIsIHsgY2xzOiBcInNlYXJjaC1pbnB1dC1jb250YWluZXJcIiB9KTtcbiAgICAgIGNvbnN0IGlucHV0ID0gc2VhcmNoX2NvbnRhaW5lci5jcmVhdGVFbChcImlucHV0XCIsIHtcbiAgICAgICAgY2xzOiBcInNjLXNlYXJjaC1pbnB1dFwiLFxuICAgICAgICB0eXBlOiBcInNlYXJjaFwiLFxuICAgICAgICBwbGFjZWhvbGRlcjogXCJUeXBlIHRvIHN0YXJ0IHNlYXJjaC4uLlwiLCBcbiAgICAgIH0pO1xuICAgICAgLy8gZm9jdXMgaW5wdXRcbiAgICAgIGlucHV0LmZvY3VzKCk7XG4gICAgICAvLyBhZGQga2V5ZG93biBsaXN0ZW5lciB0byBpbnB1dFxuICAgICAgaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGV2ZW50KSA9PiB7XG4gICAgICAgIC8vIGlmIGVzY2FwZSBrZXkgaXMgcHJlc3NlZFxuICAgICAgICBpZiAoZXZlbnQua2V5ID09PSBcIkVzY2FwZVwiKSB7XG4gICAgICAgICAgdGhpcy5jbGVhcl9hdXRvX3NlYXJjaGVyKCk7XG4gICAgICAgICAgLy8gY2xlYXIgdG9wIGJhclxuICAgICAgICAgIHRoaXMuaW5pdGlhdGVfdG9wX2Jhcihjb250YWluZXIsIG5lYXJlc3RfY29udGV4dCk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICAvLyBhZGQga2V5dXAgbGlzdGVuZXIgdG8gaW5wdXRcbiAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJrZXl1cFwiLCAoZXZlbnQpID0+IHtcbiAgICAgICAgLy8gaWYgdGhpcy5zZWFyY2hfdGltZW91dCBpcyBub3QgbnVsbCB0aGVuIGNsZWFyIGl0IGFuZCBzZXQgdG8gbnVsbFxuICAgICAgICB0aGlzLmNsZWFyX2F1dG9fc2VhcmNoZXIoKTtcbiAgICAgICAgLy8gZ2V0IHNlYXJjaCB0ZXJtXG4gICAgICAgIGNvbnN0IHNlYXJjaF90ZXJtID0gaW5wdXQudmFsdWU7XG4gICAgICAgIC8vIGlmIGVudGVyIGtleSBpcyBwcmVzc2VkXG4gICAgICAgIGlmIChldmVudC5rZXkgPT09IFwiRW50ZXJcIiAmJiBzZWFyY2hfdGVybSAhPT0gXCJcIikge1xuICAgICAgICAgIHRoaXMuc2VhcmNoKHNlYXJjaF90ZXJtKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBpZiBhbnkgb3RoZXIga2V5IGlzIHByZXNzZWQgYW5kIGlucHV0IGlzIG5vdCBlbXB0eSB0aGVuIHdhaXQgNTAwbXMgYW5kIG1ha2VfY29ubmVjdGlvbnNcbiAgICAgICAgZWxzZSBpZiAoc2VhcmNoX3Rlcm0gIT09IFwiXCIpIHtcbiAgICAgICAgICAvLyBjbGVhciB0aW1lb3V0XG4gICAgICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuc2VhcmNoX3RpbWVvdXQpO1xuICAgICAgICAgIC8vIHNldCB0aW1lb3V0XG4gICAgICAgICAgdGhpcy5zZWFyY2hfdGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5zZWFyY2goc2VhcmNoX3Rlcm0sIHRydWUpO1xuICAgICAgICAgIH0sIDcwMCk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gcmVuZGVyIGJ1dHRvbnM6IFwiY3JlYXRlXCIgYW5kIFwicmV0cnlcIiBmb3IgbG9hZGluZyBlbWJlZGRpbmdzLmpzb24gZmlsZVxuICByZW5kZXJfZW1iZWRkaW5nc19idXR0b25zKCkge1xuICAgIC8vIGdldCBjb250YWluZXIgZWxlbWVudFxuICAgIGNvbnN0IGNvbnRhaW5lciA9IHRoaXMuY29udGFpbmVyRWwuY2hpbGRyZW5bMV07XG4gICAgLy8gY2xlYXIgY29udGFpbmVyXG4gICAgY29udGFpbmVyLmVtcHR5KCk7XG4gICAgLy8gY3JlYXRlIGhlYWRpbmcgdGhhdCBzYXlzIFwiRW1iZWRkaW5ncyBmaWxlIG5vdCBmb3VuZFwiXG4gICAgY29udGFpbmVyLmNyZWF0ZUVsKFwiaDJcIiwgeyBjbHM6IFwic2NIZWFkaW5nXCIsIHRleHQ6IFwiRW1iZWRkaW5ncyBmaWxlIG5vdCBmb3VuZFwiIH0pO1xuICAgIC8vIGNyZWF0ZSBkaXYgZm9yIGJ1dHRvbnNcbiAgICBjb25zdCBidXR0b25fZGl2ID0gY29udGFpbmVyLmNyZWF0ZUVsKFwiZGl2XCIsIHsgY2xzOiBcInNjQnV0dG9uRGl2XCIgfSk7XG4gICAgLy8gY3JlYXRlIFwiY3JlYXRlXCIgYnV0dG9uXG4gICAgY29uc3QgY3JlYXRlX2J1dHRvbiA9IGJ1dHRvbl9kaXYuY3JlYXRlRWwoXCJidXR0b25cIiwgeyBjbHM6IFwic2NCdXR0b25cIiwgdGV4dDogXCJDcmVhdGUgZW1iZWRkaW5ncy5qc29uXCIgfSk7XG4gICAgLy8gbm90ZSB0aGF0IGNyZWF0aW5nIGVtYmVkZGluZ3MuanNvbiBmaWxlIHdpbGwgdHJpZ2dlciBidWxrIGVtYmVkZGluZyBhbmQgbWF5IHRha2UgYSB3aGlsZVxuICAgIGJ1dHRvbl9kaXYuY3JlYXRlRWwoXCJwXCIsIHsgY2xzOiBcInNjQnV0dG9uTm90ZVwiLCB0ZXh0OiBcIldhcm5pbmc6IENyZWF0aW5nIGVtYmVkZGluZ3MuanNvbiBmaWxlIHdpbGwgdHJpZ2dlciBidWxrIGVtYmVkZGluZyBhbmQgbWF5IHRha2UgYSB3aGlsZVwiIH0pO1xuICAgIC8vIGNyZWF0ZSBcInJldHJ5XCIgYnV0dG9uXG4gICAgY29uc3QgcmV0cnlfYnV0dG9uID0gYnV0dG9uX2Rpdi5jcmVhdGVFbChcImJ1dHRvblwiLCB7IGNsczogXCJzY0J1dHRvblwiLCB0ZXh0OiBcIlJldHJ5XCIgfSk7XG4gICAgLy8gdHJ5IHRvIGxvYWQgZW1iZWRkaW5ncy5qc29uIGZpbGUgYWdhaW5cbiAgICBidXR0b25fZGl2LmNyZWF0ZUVsKFwicFwiLCB7IGNsczogXCJzY0J1dHRvbk5vdGVcIiwgdGV4dDogXCJJZiBlbWJlZGRpbmdzLmpzb24gZmlsZSBhbHJlYWR5IGV4aXN0cywgY2xpY2sgJ1JldHJ5JyB0byBsb2FkIGl0XCIgfSk7XG5cbiAgICAvLyBhZGQgY2xpY2sgZXZlbnQgdG8gXCJjcmVhdGVcIiBidXR0b25cbiAgICBjcmVhdGVfYnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoZXZlbnQpID0+IHtcbiAgICAgIC8vIGNyZWF0ZSBlbWJlZGRpbmdzLmpzb24gZmlsZVxuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc21hcnRfdmVjX2xpdGUuaW5pdF9lbWJlZGRpbmdzX2ZpbGUoKTtcbiAgICAgIC8vIHJlbG9hZCB2aWV3XG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcl9jb25uZWN0aW9ucygpO1xuICAgIH0pO1xuXG4gICAgLy8gYWRkIGNsaWNrIGV2ZW50IHRvIFwicmV0cnlcIiBidXR0b25cbiAgICByZXRyeV9idXR0b24uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGFzeW5jIChldmVudCkgPT4ge1xuICAgICAgY29uc29sZS5sb2coXCJyZXRyeWluZyB0byBsb2FkIGVtYmVkZGluZ3MuanNvbiBmaWxlXCIpO1xuICAgICAgLy8gcmVsb2FkIGVtYmVkZGluZ3MuanNvbiBmaWxlXG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5pbml0X3ZlY3MoKTtcbiAgICAgIC8vIHJlbG9hZCB2aWV3XG4gICAgICBhd2FpdCB0aGlzLnJlbmRlcl9jb25uZWN0aW9ucygpO1xuICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgb25PcGVuKCkge1xuICAgIGNvbnN0IGNvbnRhaW5lciA9IHRoaXMuY29udGFpbmVyRWwuY2hpbGRyZW5bMV07XG4gICAgY29udGFpbmVyLmVtcHR5KCk7XG4gICAgLy8gcGxhY2Vob2xkZXIgdGV4dFxuICAgIGNvbnRhaW5lci5jcmVhdGVFbChcInBcIiwgeyBjbHM6IFwic2NQbGFjZWhvbGRlclwiLCB0ZXh0OiBcIk9wZW4gYSBub3RlIHRvIGZpbmQgY29ubmVjdGlvbnMuXCIgfSk7IFxuXG4gICAgLy8gcnVucyB3aGVuIGZpbGUgaXMgb3BlbmVkXG4gICAgdGhpcy5wbHVnaW4ucmVnaXN0ZXJFdmVudCh0aGlzLmFwcC53b3Jrc3BhY2Uub24oJ2ZpbGUtb3BlbicsIChmaWxlKSA9PiB7XG4gICAgICAvLyBpZiBubyBmaWxlIGlzIG9wZW4sIHJldHVyblxuICAgICAgaWYoIWZpbGUpIHtcbiAgICAgICAgLy8gY29uc29sZS5sb2coXCJubyBmaWxlIG9wZW4sIHJldHVybmluZ1wiKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgLy8gcmV0dXJuIGlmIGZpbGUgdHlwZSBpcyBub3Qgc3VwcG9ydGVkXG4gICAgICBpZihTVVBQT1JURURfRklMRV9UWVBFUy5pbmRleE9mKGZpbGUuZXh0ZW5zaW9uKSA9PT0gLTEpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc2V0X21lc3NhZ2UoW1xuICAgICAgICAgIFwiRmlsZTogXCIrZmlsZS5uYW1lXG4gICAgICAgICAgLFwiVW5zdXBwb3J0ZWQgZmlsZSB0eXBlIChTdXBwb3J0ZWQ6IFwiK1NVUFBPUlRFRF9GSUxFX1RZUEVTLmpvaW4oXCIsIFwiKStcIilcIlxuICAgICAgICBdKTtcbiAgICAgIH1cbiAgICAgIC8vIHJ1biByZW5kZXJfY29ubmVjdGlvbnMgYWZ0ZXIgMSBzZWNvbmQgdG8gYWxsb3cgZm9yIGZpbGUgdG8gbG9hZFxuICAgICAgaWYodGhpcy5sb2FkX3dhaXQpe1xuICAgICAgICBjbGVhclRpbWVvdXQodGhpcy5sb2FkX3dhaXQpO1xuICAgICAgfVxuICAgICAgdGhpcy5sb2FkX3dhaXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgdGhpcy5yZW5kZXJfY29ubmVjdGlvbnMoZmlsZSk7XG4gICAgICAgIHRoaXMubG9hZF93YWl0ID0gbnVsbDtcbiAgICAgIH0sIDEwMDApO1xuICAgICAgICBcbiAgICB9KSk7XG5cbiAgICB0aGlzLmFwcC53b3Jrc3BhY2UucmVnaXN0ZXJIb3ZlckxpbmtTb3VyY2UoU01BUlRfQ09OTkVDVElPTlNfVklFV19UWVBFLCB7XG4gICAgICAgIGRpc3BsYXk6ICdTbWFydCBDb25uZWN0aW9ucyBGaWxlcycsXG4gICAgICAgIGRlZmF1bHRNb2Q6IHRydWUsXG4gICAgfSk7XG4gICAgdGhpcy5hcHAud29ya3NwYWNlLnJlZ2lzdGVySG92ZXJMaW5rU291cmNlKFNNQVJUX0NPTk5FQ1RJT05TX0NIQVRfVklFV19UWVBFLCB7XG4gICAgICAgIGRpc3BsYXk6ICdTbWFydCBDaGF0IExpbmtzJyxcbiAgICAgICAgZGVmYXVsdE1vZDogdHJ1ZSxcbiAgICB9KTtcblxuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KHRoaXMuaW5pdGlhbGl6ZS5iaW5kKHRoaXMpKTtcbiAgICBcbiAgfVxuICBcbiAgYXN5bmMgaW5pdGlhbGl6ZSgpIHtcbiAgICB0aGlzLnNldF9tZXNzYWdlKFwiTG9hZGluZyBlbWJlZGRpbmdzIGZpbGUuLi5cIik7XG4gICAgY29uc3QgdmVjc19pbnRpYXRlZCA9IGF3YWl0IHRoaXMucGx1Z2luLmluaXRfdmVjcygpO1xuICAgIGlmKHZlY3NfaW50aWF0ZWQpe1xuICAgICAgdGhpcy5zZXRfbWVzc2FnZShcIkVtYmVkZGluZ3MgZmlsZSBsb2FkZWQuXCIpO1xuICAgICAgYXdhaXQgdGhpcy5yZW5kZXJfY29ubmVjdGlvbnMoKTtcbiAgICB9ZWxzZXtcbiAgICAgIHRoaXMucmVuZGVyX2VtYmVkZGluZ3NfYnV0dG9ucygpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEVYUEVSSU1FTlRBTFxuICAgICAqIC0gd2luZG93LWJhc2VkIEFQSSBhY2Nlc3NcbiAgICAgKiAtIGNvZGUtYmxvY2sgcmVuZGVyaW5nXG4gICAgICovXG4gICAgdGhpcy5hcGkgPSBuZXcgU21hcnRDb25uZWN0aW9uc1ZpZXdBcGkodGhpcy5hcHAsIHRoaXMucGx1Z2luLCB0aGlzKTtcbiAgICAvLyByZWdpc3RlciBBUEkgdG8gZ2xvYmFsIHdpbmRvdyBvYmplY3RcbiAgICAod2luZG93W1wiU21hcnRDb25uZWN0aW9uc1ZpZXdBcGlcIl0gPSB0aGlzLmFwaSkgJiYgdGhpcy5yZWdpc3RlcigoKSA9PiBkZWxldGUgd2luZG93W1wiU21hcnRDb25uZWN0aW9uc1ZpZXdBcGlcIl0pO1xuXG4gIH1cblxuICBhc3luYyBvbkNsb3NlKCkge1xuICAgIGNvbnNvbGUubG9nKFwiY2xvc2luZyBzbWFydCBjb25uZWN0aW9ucyB2aWV3XCIpO1xuICAgIHRoaXMuYXBwLndvcmtzcGFjZS51bnJlZ2lzdGVySG92ZXJMaW5rU291cmNlKFNNQVJUX0NPTk5FQ1RJT05TX1ZJRVdfVFlQRSk7XG4gICAgdGhpcy5wbHVnaW4udmlldyA9IG51bGw7XG4gIH1cblxuICBhc3luYyByZW5kZXJfY29ubmVjdGlvbnMoY29udGV4dD1udWxsKSB7XG4gICAgY29uc29sZS5sb2coXCJyZW5kZXJpbmcgY29ubmVjdGlvbnNcIik7XG4gICAgLy8gaWYgQVBJIGtleSBpcyBub3Qgc2V0IHRoZW4gdXBkYXRlIHZpZXcgbWVzc2FnZVxuICAgIGlmKCF0aGlzLnBsdWdpbi5zZXR0aW5ncy5hcGlfa2V5KSB7XG4gICAgICB0aGlzLnNldF9tZXNzYWdlKFwiQW4gT3BlbkFJIEFQSSBrZXkgaXMgcmVxdWlyZWQgdG8gbWFrZSBTbWFydCBDb25uZWN0aW9uc1wiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYoIXRoaXMucGx1Z2luLmVtYmVkZGluZ3NfbG9hZGVkKXtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLmluaXRfdmVjcygpO1xuICAgIH1cbiAgICAvLyBpZiBlbWJlZGRpbmcgc3RpbGwgbm90IGxvYWRlZCwgcmV0dXJuXG4gICAgaWYoIXRoaXMucGx1Z2luLmVtYmVkZGluZ3NfbG9hZGVkKSB7XG4gICAgICBjb25zb2xlLmxvZyhcImVtYmVkZGluZ3MgZmlsZXMgc3RpbGwgbm90IGxvYWRlZCBvciB5ZXQgdG8gYmUgY3JlYXRlZFwiKTtcbiAgICAgIHRoaXMucmVuZGVyX2VtYmVkZGluZ3NfYnV0dG9ucygpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLnNldF9tZXNzYWdlKFwiTWFraW5nIFNtYXJ0IENvbm5lY3Rpb25zLi4uXCIpO1xuICAgIC8qKlxuICAgICAqIEJlZ2luIGhpZ2hsaWdodGVkLXRleHQtbGV2ZWwgc2VhcmNoXG4gICAgICovXG4gICAgaWYodHlwZW9mIGNvbnRleHQgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIGNvbnN0IGhpZ2hsaWdodGVkX3RleHQgPSBjb250ZXh0O1xuICAgICAgLy8gZ2V0IGVtYmVkZGluZyBmb3IgaGlnaGxpZ2h0ZWQgdGV4dFxuICAgICAgYXdhaXQgdGhpcy5zZWFyY2goaGlnaGxpZ2h0ZWRfdGV4dCk7XG4gICAgICByZXR1cm47IC8vIGVuZHMgaGVyZSBpZiBjb250ZXh0IGlzIGEgc3RyaW5nXG4gICAgfVxuXG4gICAgLyoqIFxuICAgICAqIEJlZ2luIGZpbGUtbGV2ZWwgc2VhcmNoXG4gICAgICovICAgIFxuICAgIHRoaXMubmVhcmVzdCA9IG51bGw7XG4gICAgdGhpcy5pbnRlcnZhbF9jb3VudCA9IDA7XG4gICAgdGhpcy5yZW5kZXJpbmcgPSBmYWxzZTtcbiAgICB0aGlzLmZpbGUgPSBjb250ZXh0O1xuICAgIC8vIGlmIHRoaXMuaW50ZXJ2YWwgaXMgc2V0IHRoZW4gY2xlYXIgaXRcbiAgICBpZih0aGlzLmludGVydmFsKSB7XG4gICAgICBjbGVhckludGVydmFsKHRoaXMuaW50ZXJ2YWwpO1xuICAgICAgdGhpcy5pbnRlcnZhbCA9IG51bGw7XG4gICAgfVxuICAgIC8vIHNldCBpbnRlcnZhbCB0byBjaGVjayBpZiBuZWFyZXN0IGlzIHNldFxuICAgIHRoaXMuaW50ZXJ2YWwgPSBzZXRJbnRlcnZhbCgoKSA9PiB7XG4gICAgICBpZighdGhpcy5yZW5kZXJpbmcpe1xuICAgICAgICBpZih0aGlzLmZpbGUgaW5zdGFuY2VvZiBPYnNpZGlhbi5URmlsZSkge1xuICAgICAgICAgIHRoaXMucmVuZGVyaW5nID0gdHJ1ZTtcbiAgICAgICAgICB0aGlzLnJlbmRlcl9ub3RlX2Nvbm5lY3Rpb25zKHRoaXMuZmlsZSk7XG4gICAgICAgIH1lbHNle1xuICAgICAgICAgIC8vIGdldCBjdXJyZW50IG5vdGVcbiAgICAgICAgICB0aGlzLmZpbGUgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpO1xuICAgICAgICAgIC8vIGlmIHN0aWxsIG5vIGN1cnJlbnQgbm90ZSB0aGVuIHJldHVyblxuICAgICAgICAgIGlmKCF0aGlzLmZpbGUgJiYgdGhpcy5jb3VudCA+IDEpIHtcbiAgICAgICAgICAgIGNsZWFySW50ZXJ2YWwodGhpcy5pbnRlcnZhbCk7XG4gICAgICAgICAgICB0aGlzLnNldF9tZXNzYWdlKFwiTm8gYWN0aXZlIGZpbGVcIik7XG4gICAgICAgICAgICByZXR1cm47IFxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfWVsc2V7XG4gICAgICAgIGlmKHRoaXMubmVhcmVzdCkge1xuICAgICAgICAgIGNsZWFySW50ZXJ2YWwodGhpcy5pbnRlcnZhbCk7XG4gICAgICAgICAgLy8gaWYgbmVhcmVzdCBpcyBhIHN0cmluZyB0aGVuIHVwZGF0ZSB2aWV3IG1lc3NhZ2VcbiAgICAgICAgICBpZiAodHlwZW9mIHRoaXMubmVhcmVzdCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICAgICAgdGhpcy5zZXRfbWVzc2FnZSh0aGlzLm5lYXJlc3QpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBzZXQgbmVhcmVzdCBjb25uZWN0aW9uc1xuICAgICAgICAgICAgdGhpcy5zZXRfbmVhcmVzdCh0aGlzLm5lYXJlc3QsIFwiRmlsZTogXCIgKyB0aGlzLmZpbGUubmFtZSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIGlmIHJlbmRlcl9sb2cuZmFpbGVkX2VtYmVkZGluZ3MgdGhlbiB1cGRhdGUgZmFpbGVkX2VtYmVkZGluZ3MudHh0XG4gICAgICAgICAgaWYgKHRoaXMucGx1Z2luLnJlbmRlcl9sb2cuZmFpbGVkX2VtYmVkZGluZ3MubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2F2ZV9mYWlsZWRfZW1iZWRkaW5ncygpO1xuICAgICAgICAgIH1cbiAgICAgICAgICAvLyBnZXQgb2JqZWN0IGtleXMgb2YgcmVuZGVyX2xvZ1xuICAgICAgICAgIHRoaXMucGx1Z2luLm91dHB1dF9yZW5kZXJfbG9nKCk7XG4gICAgICAgICAgcmV0dXJuOyBcbiAgICAgICAgfWVsc2V7XG4gICAgICAgICAgdGhpcy5pbnRlcnZhbF9jb3VudCsrO1xuICAgICAgICAgIHRoaXMuc2V0X21lc3NhZ2UoXCJNYWtpbmcgU21hcnQgQ29ubmVjdGlvbnMuLi5cIit0aGlzLmludGVydmFsX2NvdW50KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0sIDEwKTtcbiAgfVxuXG4gIGFzeW5jIHJlbmRlcl9ub3RlX2Nvbm5lY3Rpb25zKGZpbGUpIHtcbiAgICB0aGlzLm5lYXJlc3QgPSBhd2FpdCB0aGlzLnBsdWdpbi5maW5kX25vdGVfY29ubmVjdGlvbnMoZmlsZSk7XG4gIH1cblxuICBjbGVhcl9hdXRvX3NlYXJjaGVyKCkge1xuICAgIGlmICh0aGlzLnNlYXJjaF90aW1lb3V0KSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5zZWFyY2hfdGltZW91dCk7XG4gICAgICB0aGlzLnNlYXJjaF90aW1lb3V0ID0gbnVsbDtcbiAgICB9XG4gIH1cblxuICBhc3luYyBzZWFyY2goc2VhcmNoX3RleHQsIHJlc3VsdHNfb25seT1mYWxzZSkge1xuICAgIGNvbnN0IG5lYXJlc3QgPSBhd2FpdCB0aGlzLnBsdWdpbi5hcGkuc2VhcmNoKHNlYXJjaF90ZXh0KTtcbiAgICAvLyByZW5kZXIgcmVzdWx0cyBpbiB2aWV3IHdpdGggZmlyc3QgMTAwIGNoYXJhY3RlcnMgb2Ygc2VhcmNoIHRleHRcbiAgICBjb25zdCBuZWFyZXN0X2NvbnRleHQgPSBgU2VsZWN0aW9uOiBcIiR7c2VhcmNoX3RleHQubGVuZ3RoID4gMTAwID8gc2VhcmNoX3RleHQuc3Vic3RyaW5nKDAsIDEwMCkgKyBcIi4uLlwiIDogc2VhcmNoX3RleHR9XCJgO1xuICAgIHRoaXMuc2V0X25lYXJlc3QobmVhcmVzdCwgbmVhcmVzdF9jb250ZXh0LCByZXN1bHRzX29ubHkpO1xuICB9XG5cbn1cbmNsYXNzIFNtYXJ0Q29ubmVjdGlvbnNWaWV3QXBpIHtcbiAgY29uc3RydWN0b3IoYXBwLCBwbHVnaW4sIHZpZXcpIHtcbiAgICB0aGlzLmFwcCA9IGFwcDtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgICB0aGlzLnZpZXcgPSB2aWV3O1xuICB9XG4gIGFzeW5jIHNlYXJjaCAoc2VhcmNoX3RleHQpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5wbHVnaW4uYXBpLnNlYXJjaChzZWFyY2hfdGV4dCk7XG4gIH1cbiAgLy8gdHJpZ2dlciByZWxvYWQgb2YgZW1iZWRkaW5ncyBmaWxlXG4gIGFzeW5jIHJlbG9hZF9lbWJlZGRpbmdzX2ZpbGUoKSB7XG4gICAgYXdhaXQgdGhpcy5wbHVnaW4uaW5pdF92ZWNzKCk7XG4gICAgYXdhaXQgdGhpcy52aWV3LnJlbmRlcl9jb25uZWN0aW9ucygpO1xuICB9XG59XG5jbGFzcyBTY1NlYXJjaEFwaSB7XG4gIGNvbnN0cnVjdG9yKGFwcCwgcGx1Z2luKSB7XG4gICAgdGhpcy5hcHAgPSBhcHA7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gIH1cbiAgYXN5bmMgc2VhcmNoIChzZWFyY2hfdGV4dCwgZmlsdGVyPXt9KSB7XG4gICAgZmlsdGVyID0ge1xuICAgICAgc2tpcF9zZWN0aW9uczogdGhpcy5wbHVnaW4uc2V0dGluZ3Muc2tpcF9zZWN0aW9ucyxcbiAgICAgIC4uLmZpbHRlclxuICAgIH1cbiAgICBsZXQgbmVhcmVzdCA9IFtdO1xuICAgIGNvbnN0IHJlc3AgPSBhd2FpdCB0aGlzLnBsdWdpbi5yZXF1ZXN0X2VtYmVkZGluZ19mcm9tX2lucHV0KHNlYXJjaF90ZXh0KTtcbiAgICBpZiAocmVzcCAmJiByZXNwLmRhdGEgJiYgcmVzcC5kYXRhWzBdICYmIHJlc3AuZGF0YVswXS5lbWJlZGRpbmcpIHtcbiAgICAgIG5lYXJlc3QgPSB0aGlzLnBsdWdpbi5zbWFydF92ZWNfbGl0ZS5uZWFyZXN0KHJlc3AuZGF0YVswXS5lbWJlZGRpbmcsIGZpbHRlcik7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIHJlc3AgaXMgbnVsbCwgdW5kZWZpbmVkLCBvciBtaXNzaW5nIGRhdGFcbiAgICAgIG5ldyBPYnNpZGlhbi5Ob3RpY2UoXCJTbWFydCBDb25uZWN0aW9uczogRXJyb3IgZ2V0dGluZyBlbWJlZGRpbmdcIik7XG4gICAgfVxuICAgIHJldHVybiBuZWFyZXN0O1xuICB9XG59XG5cbmNsYXNzIFNtYXJ0Q29ubmVjdGlvbnNTZXR0aW5nc1RhYiBleHRlbmRzIE9ic2lkaWFuLlBsdWdpblNldHRpbmdUYWIge1xuICBjb25zdHJ1Y3RvcihhcHAsIHBsdWdpbikge1xuICAgIHN1cGVyKGFwcCwgcGx1Z2luKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgfVxuICBkaXNwbGF5KCkge1xuICAgIGNvbnN0IHtcbiAgICAgIGNvbnRhaW5lckVsXG4gICAgfSA9IHRoaXM7XG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcImgyXCIsIHtcbiAgICAgIHRleHQ6IFwiU3VwcG9ydGVyIFNldHRpbmdzXCJcbiAgICB9KTtcbiAgICAvLyBsaXN0IHN1cHBvcnRlciBiZW5lZml0c1xuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICB0ZXh0OiBcIkFzIGEgU21hcnQgQ29ubmVjdGlvbnMgXFxcIlN1cHBvcnRlclxcXCIsIGZhc3QtdHJhY2sgeW91ciBQS00gam91cm5leSB3aXRoIHByaW9yaXR5IHBlcmtzIGFuZCBwaW9uZWVyaW5nIGlubm92YXRpb25zLlwiXG4gICAgfSk7XG4gICAgLy8gdGhyZWUgbGlzdCBpdGVtc1xuICAgIGNvbnN0IHN1cHBvcnRlcl9iZW5lZml0c19saXN0ID0gY29udGFpbmVyRWwuY3JlYXRlRWwoXCJ1bFwiKTtcbiAgICBzdXBwb3J0ZXJfYmVuZWZpdHNfbGlzdC5jcmVhdGVFbChcImxpXCIsIHtcbiAgICAgIHRleHQ6IFwiRW5qb3kgc3dpZnQsIHRvcC1wcmlvcml0eSBzdXBwb3J0LlwiXG4gICAgfSk7XG4gICAgc3VwcG9ydGVyX2JlbmVmaXRzX2xpc3QuY3JlYXRlRWwoXCJsaVwiLCB7XG4gICAgICB0ZXh0OiBcIkdhaW4gZWFybHkgYWNjZXNzIHRvIGV4cGVyaW1lbnRhbCBmZWF0dXJlcyBsaWtlIHRoZSBDaGF0R1BUIHBsdWdpbi5cIlxuICAgIH0pO1xuICAgIHN1cHBvcnRlcl9iZW5lZml0c19saXN0LmNyZWF0ZUVsKFwibGlcIiwge1xuICAgICAgdGV4dDogXCJTdGF5IGluZm9ybWVkIGFuZCBlbmdhZ2VkIHdpdGggZXhjbHVzaXZlIHN1cHBvcnRlci1vbmx5IGNvbW11bmljYXRpb25zLlwiXG4gICAgfSk7XG4gICAgLy8gYWRkIGEgdGV4dCBpbnB1dCB0byBlbnRlciBzdXBwb3J0ZXIgbGljZW5zZSBrZXlcbiAgICBuZXcgT2JzaWRpYW4uU2V0dGluZyhjb250YWluZXJFbCkuc2V0TmFtZShcIlN1cHBvcnRlciBMaWNlbnNlIEtleVwiKS5zZXREZXNjKFwiTm90ZTogdGhpcyBpcyBub3QgcmVxdWlyZWQgdG8gdXNlIFNtYXJ0IENvbm5lY3Rpb25zLlwiKS5hZGRUZXh0KCh0ZXh0KSA9PiB0ZXh0LnNldFBsYWNlaG9sZGVyKFwiRW50ZXIgeW91ciBsaWNlbnNlX2tleVwiKS5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5saWNlbnNlX2tleSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5saWNlbnNlX2tleSA9IHZhbHVlLnRyaW0oKTtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncyh0cnVlKTtcbiAgICB9KSk7XG4gICAgLy8gYWRkIGJ1dHRvbiB0byB0cmlnZ2VyIHN5bmMgbm90ZXMgdG8gdXNlIHdpdGggQ2hhdEdQVFxuICAgIG5ldyBPYnNpZGlhbi5TZXR0aW5nKGNvbnRhaW5lckVsKS5zZXROYW1lKFwiU3luYyBOb3Rlc1wiKS5zZXREZXNjKFwiTWFrZSBub3RlcyBhdmFpbGFibGUgdmlhIHRoZSBTbWFydCBDb25uZWN0aW9ucyBDaGF0R1BUIFBsdWdpbi4gUmVzcGVjdHMgZXhjbHVzaW9uIHNldHRpbmdzIGNvbmZpZ3VyZWQgYmVsb3cuXCIpLmFkZEJ1dHRvbigoYnV0dG9uKSA9PiBidXR0b24uc2V0QnV0dG9uVGV4dChcIlN5bmMgTm90ZXNcIikub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAvLyBzeW5jIG5vdGVzXG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zeW5jX25vdGVzKCk7XG4gICAgfSkpO1xuICAgIC8vIGFkZCBidXR0b24gdG8gYmVjb21lIGEgc3VwcG9ydGVyXG4gICAgbmV3IE9ic2lkaWFuLlNldHRpbmcoY29udGFpbmVyRWwpLnNldE5hbWUoXCJCZWNvbWUgYSBTdXBwb3J0ZXJcIikuc2V0RGVzYyhcIkJlY29tZSBhIFN1cHBvcnRlclwiKS5hZGRCdXR0b24oKGJ1dHRvbikgPT4gYnV0dG9uLnNldEJ1dHRvblRleHQoXCJCZWNvbWUgYSBTdXBwb3J0ZXJcIikub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBwYXltZW50X3BhZ2VzID0gW1xuICAgICAgICBcImh0dHBzOi8vYnV5LnN0cmlwZS5jb20vOUFRNWtPNVFuYkFXZ0dBYklZXCIsXG4gICAgICAgIFwiaHR0cHM6Ly9idXkuc3RyaXBlLmNvbS85QVE3c1dlbVQ0OHUxTEdjTjRcIlxuICAgICAgXTtcbiAgICAgIGlmKCF0aGlzLnBsdWdpbi5wYXltZW50X3BhZ2VfaW5kZXgpe1xuICAgICAgICB0aGlzLnBsdWdpbi5wYXltZW50X3BhZ2VfaW5kZXggPSBNYXRoLnJvdW5kKE1hdGgucmFuZG9tKCkpO1xuICAgICAgfVxuICAgICAgLy8gb3BlbiBzdXBwb3J0ZXIgcGFnZSBpbiBicm93c2VyXG4gICAgICB3aW5kb3cub3BlbihwYXltZW50X3BhZ2VzW3RoaXMucGx1Z2luLnBheW1lbnRfcGFnZV9pbmRleF0pO1xuICAgIH0pKTtcblxuICAgIFxuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiaDJcIiwge1xuICAgICAgdGV4dDogXCJPcGVuQUkgU2V0dGluZ3NcIlxuICAgIH0pO1xuICAgIC8vIGFkZCBhIHRleHQgaW5wdXQgdG8gZW50ZXIgdGhlIEFQSSBrZXlcbiAgICBuZXcgT2JzaWRpYW4uU2V0dGluZyhjb250YWluZXJFbCkuc2V0TmFtZShcIk9wZW5BSSBBUEkgS2V5XCIpLnNldERlc2MoXCJSZXF1aXJlZDogYW4gT3BlbkFJIEFQSSBrZXkgaXMgY3VycmVudGx5IHJlcXVpcmVkIHRvIHVzZSBTbWFydCBDb25uZWN0aW9ucy5cIikuYWRkVGV4dCgodGV4dCkgPT4gdGV4dC5zZXRQbGFjZWhvbGRlcihcIkVudGVyIHlvdXIgYXBpX2tleVwiKS5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5hcGlfa2V5KS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmFwaV9rZXkgPSB2YWx1ZS50cmltKCk7XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3ModHJ1ZSk7XG4gICAgfSkpO1xuICAgIC8vIGFkZCBhIHRleHQgaW5wdXQgdG8gZW50ZXIgdGhlIEFQSSBlbmRwb2ludFxuICAgIG5ldyBPYnNpZGlhbi5TZXR0aW5nKGNvbnRhaW5lckVsKS5zZXROYW1lKFwiT3BlbkFJIEFQSSBFbmRwb2ludFwiKS5zZXREZXNjKFwiT3B0aW9uYWw6IGFuIE9wZW5BSSBBUEkgZW5kcG9pbnQgaXMgdXNlZCB0byB1c2UgU21hcnQgQ29ubmVjdGlvbnMuXCIpLmFkZFRleHQoKHRleHQpID0+IHRleHQuc2V0UGxhY2Vob2xkZXIoXCJFbnRlciB5b3VyIGFwaV9lbmRwb2ludFwiKS5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5hcGlfZW5kcG9pbnQpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuYXBpX2VuZHBvaW50ID0gdmFsdWUudHJpbSgpO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKHRydWUpO1xuICAgIH0pKTtcbiAgICAvLyBhZGQgYSBidXR0b24gdG8gdGVzdCB0aGUgQVBJIGtleSBpcyB3b3JraW5nXG4gICAgbmV3IE9ic2lkaWFuLlNldHRpbmcoY29udGFpbmVyRWwpLnNldE5hbWUoXCJUZXN0IEFQSSBLZXlcIikuc2V0RGVzYyhcIlRlc3QgQVBJIEtleVwiKS5hZGRCdXR0b24oKGJ1dHRvbikgPT4gYnV0dG9uLnNldEJ1dHRvblRleHQoXCJUZXN0IEFQSSBLZXlcIikub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAvLyB0ZXN0IEFQSSBrZXlcbiAgICAgIGNvbnN0IHJlc3AgPSBhd2FpdCB0aGlzLnBsdWdpbi50ZXN0X2FwaV9rZXkoKTtcbiAgICAgIGlmKHJlc3ApIHtcbiAgICAgICAgbmV3IE9ic2lkaWFuLk5vdGljZShcIlNtYXJ0IENvbm5lY3Rpb25zOiBBUEkga2V5IGlzIHZhbGlkXCIpO1xuICAgICAgfWVsc2V7XG4gICAgICAgIG5ldyBPYnNpZGlhbi5Ob3RpY2UoXCJTbWFydCBDb25uZWN0aW9uczogQVBJIGtleSBpcyBub3Qgd29ya2luZyBhcyBleHBlY3RlZCFcIik7XG4gICAgICB9XG4gICAgfSkpO1xuICAgIC8vIGFkZCBkcm9wZG93biB0byBzZWxlY3QgdGhlIG1vZGVsXG4gICAgbmV3IE9ic2lkaWFuLlNldHRpbmcoY29udGFpbmVyRWwpLnNldE5hbWUoXCJTbWFydCBDaGF0IE1vZGVsXCIpLnNldERlc2MoXCJTZWxlY3QgYSBtb2RlbCB0byB1c2Ugd2l0aCBTbWFydCBDaGF0LlwiKS5hZGREcm9wZG93bigoZHJvcGRvd24pID0+IHtcbiAgICAgIGRyb3Bkb3duLmFkZE9wdGlvbihcImdwdC0zLjUtdHVyYm8tMTZrXCIsIFwiZ3B0LTMuNS10dXJiby0xNmtcIik7XG4gICAgICBkcm9wZG93bi5hZGRPcHRpb24oXCJncHQtNFwiLCBcImdwdC00IChsaW1pdGVkIGFjY2VzcywgOGspXCIpO1xuICAgICAgZHJvcGRvd24uYWRkT3B0aW9uKFwiZ3B0LTMuNS10dXJib1wiLCBcImdwdC0zLjUtdHVyYm8gKDRrKVwiKTtcbiAgICAgIGRyb3Bkb3duLmFkZE9wdGlvbihcImdwdC00LTExMDYtcHJldmlld1wiLCBcImdwdC00LXR1cmJvICgxMjhrKVwiKTtcbiAgICAgIGRyb3Bkb3duLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5zbWFydF9jaGF0X21vZGVsID0gdmFsdWU7XG4gICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgfSk7XG4gICAgICBkcm9wZG93bi5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5zbWFydF9jaGF0X21vZGVsKTtcbiAgICB9KTtcbiAgICAvLyBsYW5ndWFnZVxuICAgIG5ldyBPYnNpZGlhbi5TZXR0aW5nKGNvbnRhaW5lckVsKS5zZXROYW1lKFwiRGVmYXVsdCBMYW5ndWFnZVwiKS5zZXREZXNjKFwiRGVmYXVsdCBsYW5ndWFnZSB0byB1c2UgZm9yIFNtYXJ0IENoYXQuIENoYW5nZXMgd2hpY2ggc2VsZi1yZWZlcmVudGlhbCBwcm9ub3VucyB3aWxsIHRyaWdnZXIgbG9va3VwIG9mIHlvdXIgbm90ZXMuXCIpLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT4ge1xuICAgICAgLy8gZ2V0IE9iamVjdCBrZXlzIGZyb20gcHJvbm91c1xuICAgICAgY29uc3QgbGFuZ3VhZ2VzID0gT2JqZWN0LmtleXMoU01BUlRfVFJBTlNMQVRJT04pO1xuICAgICAgZm9yKGxldCBpID0gMDsgaSA8IGxhbmd1YWdlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICBkcm9wZG93bi5hZGRPcHRpb24obGFuZ3VhZ2VzW2ldLCBsYW5ndWFnZXNbaV0pO1xuICAgICAgfVxuICAgICAgZHJvcGRvd24ub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmxhbmd1YWdlID0gdmFsdWU7XG4gICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICBzZWxmX3JlZl9wcm9ub3Vuc19saXN0LnNldFRleHQodGhpcy5nZXRfc2VsZl9yZWZfbGlzdCgpKTtcbiAgICAgICAgLy8gaWYgY2hhdCB2aWV3IGlzIG9wZW4gdGhlbiBydW4gbmV3X2NoYXQoKVxuICAgICAgICBjb25zdCBjaGF0X3ZpZXcgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFNNQVJUX0NPTk5FQ1RJT05TX0NIQVRfVklFV19UWVBFKS5sZW5ndGggPiAwID8gdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShTTUFSVF9DT05ORUNUSU9OU19DSEFUX1ZJRVdfVFlQRSlbMF0udmlldyA6IG51bGw7XG4gICAgICAgIGlmKGNoYXRfdmlldykge1xuICAgICAgICAgIGNoYXRfdmlldy5uZXdfY2hhdCgpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIGRyb3Bkb3duLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmxhbmd1YWdlKTtcbiAgICB9KTtcbiAgICAvLyBsaXN0IGN1cnJlbnQgc2VsZi1yZWZlcmVudGlhbCBwcm9ub3Vuc1xuICAgIGNvbnN0IHNlbGZfcmVmX3Byb25vdW5zX2xpc3QgPSBjb250YWluZXJFbC5jcmVhdGVFbChcInNwYW5cIiwge1xuICAgICAgdGV4dDogdGhpcy5nZXRfc2VsZl9yZWZfbGlzdCgpXG4gICAgfSk7XG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJoMlwiLCB7XG4gICAgICB0ZXh0OiBcIkV4Y2x1c2lvbnNcIlxuICAgIH0pO1xuICAgIC8vIGxpc3QgZmlsZSBleGNsdXNpb25zXG4gICAgbmV3IE9ic2lkaWFuLlNldHRpbmcoY29udGFpbmVyRWwpLnNldE5hbWUoXCJmaWxlX2V4Y2x1c2lvbnNcIikuc2V0RGVzYyhcIidFeGNsdWRlZCBmaWxlJyBtYXRjaGVycyBzZXBhcmF0ZWQgYnkgYSBjb21tYS5cIikuYWRkVGV4dCgodGV4dCkgPT4gdGV4dC5zZXRQbGFjZWhvbGRlcihcImRyYXdpbmdzLHByb21wdHMvbG9nc1wiKS5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5maWxlX2V4Y2x1c2lvbnMpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuZmlsZV9leGNsdXNpb25zID0gdmFsdWU7XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICB9KSk7XG4gICAgLy8gbGlzdCBmb2xkZXIgZXhjbHVzaW9uc1xuICAgIG5ldyBPYnNpZGlhbi5TZXR0aW5nKGNvbnRhaW5lckVsKS5zZXROYW1lKFwiZm9sZGVyX2V4Y2x1c2lvbnNcIikuc2V0RGVzYyhcIidFeGNsdWRlZCBmb2xkZXInIG1hdGNoZXJzIHNlcGFyYXRlZCBieSBhIGNvbW1hLlwiKS5hZGRUZXh0KCh0ZXh0KSA9PiB0ZXh0LnNldFBsYWNlaG9sZGVyKFwiZHJhd2luZ3MscHJvbXB0cy9sb2dzXCIpLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmZvbGRlcl9leGNsdXNpb25zKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmZvbGRlcl9leGNsdXNpb25zID0gdmFsdWU7XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICB9KSk7XG4gICAgLy8gbGlzdCBwYXRoIG9ubHkgbWF0Y2hlcnNcbiAgICBuZXcgT2JzaWRpYW4uU2V0dGluZyhjb250YWluZXJFbCkuc2V0TmFtZShcInBhdGhfb25seVwiKS5zZXREZXNjKFwiJ1BhdGggb25seScgbWF0Y2hlcnMgc2VwYXJhdGVkIGJ5IGEgY29tbWEuXCIpLmFkZFRleHQoKHRleHQpID0+IHRleHQuc2V0UGxhY2Vob2xkZXIoXCJkcmF3aW5ncyxwcm9tcHRzL2xvZ3NcIikuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MucGF0aF9vbmx5KS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnBhdGhfb25seSA9IHZhbHVlO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgfSkpO1xuICAgIC8vIGxpc3QgaGVhZGVyIGV4Y2x1c2lvbnNcbiAgICBuZXcgT2JzaWRpYW4uU2V0dGluZyhjb250YWluZXJFbCkuc2V0TmFtZShcImhlYWRlcl9leGNsdXNpb25zXCIpLnNldERlc2MoXCInRXhjbHVkZWQgaGVhZGVyJyBtYXRjaGVycyBzZXBhcmF0ZWQgYnkgYSBjb21tYS4gV29ya3MgZm9yICdibG9ja3MnIG9ubHkuXCIpLmFkZFRleHQoKHRleHQpID0+IHRleHQuc2V0UGxhY2Vob2xkZXIoXCJkcmF3aW5ncyxwcm9tcHRzL2xvZ3NcIikuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuaGVhZGVyX2V4Y2x1c2lvbnMpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuaGVhZGVyX2V4Y2x1c2lvbnMgPSB2YWx1ZTtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgIH0pKTtcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcImgyXCIsIHtcbiAgICAgIHRleHQ6IFwiRGlzcGxheVwiXG4gICAgfSk7XG4gICAgLy8gdG9nZ2xlIHNob3dpbmcgZnVsbCBwYXRoIGluIHZpZXdcbiAgICBuZXcgT2JzaWRpYW4uU2V0dGluZyhjb250YWluZXJFbCkuc2V0TmFtZShcInNob3dfZnVsbF9wYXRoXCIpLnNldERlc2MoXCJTaG93IGZ1bGwgcGF0aCBpbiB2aWV3LlwiKS5hZGRUb2dnbGUoKHRvZ2dsZSkgPT4gdG9nZ2xlLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLnNob3dfZnVsbF9wYXRoKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnNob3dfZnVsbF9wYXRoID0gdmFsdWU7XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3ModHJ1ZSk7XG4gICAgfSkpO1xuICAgIC8vIHRvZ2dsZSBleHBhbmRlZCB2aWV3IGJ5IGRlZmF1bHRcbiAgICBuZXcgT2JzaWRpYW4uU2V0dGluZyhjb250YWluZXJFbCkuc2V0TmFtZShcImV4cGFuZGVkX3ZpZXdcIikuc2V0RGVzYyhcIkV4cGFuZGVkIHZpZXcgYnkgZGVmYXVsdC5cIikuYWRkVG9nZ2xlKCh0b2dnbGUpID0+IHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5leHBhbmRlZF92aWV3KS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmV4cGFuZGVkX3ZpZXcgPSB2YWx1ZTtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncyh0cnVlKTtcbiAgICB9KSk7XG4gICAgLy8gdG9nZ2xlIGdyb3VwIG5lYXJlc3QgYnkgZmlsZVxuICAgIG5ldyBPYnNpZGlhbi5TZXR0aW5nKGNvbnRhaW5lckVsKS5zZXROYW1lKFwiZ3JvdXBfbmVhcmVzdF9ieV9maWxlXCIpLnNldERlc2MoXCJHcm91cCBuZWFyZXN0IGJ5IGZpbGUuXCIpLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PiB0b2dnbGUuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuZ3JvdXBfbmVhcmVzdF9ieV9maWxlKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmdyb3VwX25lYXJlc3RfYnlfZmlsZSA9IHZhbHVlO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKHRydWUpO1xuICAgIH0pKTtcbiAgICAvLyB0b2dnbGUgdmlld19vcGVuIG9uIE9ic2lkaWFuIHN0YXJ0dXBcbiAgICBuZXcgT2JzaWRpYW4uU2V0dGluZyhjb250YWluZXJFbCkuc2V0TmFtZShcInZpZXdfb3BlblwiKS5zZXREZXNjKFwiT3BlbiB2aWV3IG9uIE9ic2lkaWFuIHN0YXJ0dXAuXCIpLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PiB0b2dnbGUuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3Mudmlld19vcGVuKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnZpZXdfb3BlbiA9IHZhbHVlO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKHRydWUpO1xuICAgIH0pKTtcbiAgICAvLyB0b2dnbGUgY2hhdF9vcGVuIG9uIE9ic2lkaWFuIHN0YXJ0dXBcbiAgICBuZXcgT2JzaWRpYW4uU2V0dGluZyhjb250YWluZXJFbCkuc2V0TmFtZShcImNoYXRfb3BlblwiKS5zZXREZXNjKFwiT3BlbiB2aWV3IG9uIE9ic2lkaWFuIHN0YXJ0dXAuXCIpLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PiB0b2dnbGUuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuY2hhdF9vcGVuKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmNoYXRfb3BlbiA9IHZhbHVlO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKHRydWUpO1xuICAgIH0pKTtcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcImgyXCIsIHtcbiAgICAgIHRleHQ6IFwiQWR2YW5jZWRcIlxuICAgIH0pO1xuICAgIC8vIHRvZ2dsZSBsb2dfcmVuZGVyXG4gICAgbmV3IE9ic2lkaWFuLlNldHRpbmcoY29udGFpbmVyRWwpLnNldE5hbWUoXCJsb2dfcmVuZGVyXCIpLnNldERlc2MoXCJMb2cgcmVuZGVyIGRldGFpbHMgdG8gY29uc29sZSAoaW5jbHVkZXMgdG9rZW5fdXNhZ2UpLlwiKS5hZGRUb2dnbGUoKHRvZ2dsZSkgPT4gdG9nZ2xlLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmxvZ19yZW5kZXIpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MubG9nX3JlbmRlciA9IHZhbHVlO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKHRydWUpO1xuICAgIH0pKTtcbiAgICAvLyB0b2dnbGUgZmlsZXMgaW4gbG9nX3JlbmRlclxuICAgIG5ldyBPYnNpZGlhbi5TZXR0aW5nKGNvbnRhaW5lckVsKS5zZXROYW1lKFwibG9nX3JlbmRlcl9maWxlc1wiKS5zZXREZXNjKFwiTG9nIGVtYmVkZGVkIG9iamVjdHMgcGF0aHMgd2l0aCBsb2cgcmVuZGVyIChmb3IgZGVidWdnaW5nKS5cIikuYWRkVG9nZ2xlKCh0b2dnbGUpID0+IHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5sb2dfcmVuZGVyX2ZpbGVzKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmxvZ19yZW5kZXJfZmlsZXMgPSB2YWx1ZTtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncyh0cnVlKTtcbiAgICB9KSk7XG4gICAgLy8gdG9nZ2xlIHNraXBfc2VjdGlvbnNcbiAgICBuZXcgT2JzaWRpYW4uU2V0dGluZyhjb250YWluZXJFbCkuc2V0TmFtZShcInNraXBfc2VjdGlvbnNcIikuc2V0RGVzYyhcIlNraXBzIG1ha2luZyBjb25uZWN0aW9ucyB0byBzcGVjaWZpYyBzZWN0aW9ucyB3aXRoaW4gbm90ZXMuIFdhcm5pbmc6IHJlZHVjZXMgdXNlZnVsbmVzcyBmb3IgbGFyZ2UgZmlsZXMgYW5kIHJlcXVpcmVzICdGb3JjZSBSZWZyZXNoJyBmb3Igc2VjdGlvbnMgdG8gd29yayBpbiB0aGUgZnV0dXJlLlwiKS5hZGRUb2dnbGUoKHRvZ2dsZSkgPT4gdG9nZ2xlLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLnNraXBfc2VjdGlvbnMpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Muc2tpcF9zZWN0aW9ucyA9IHZhbHVlO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKHRydWUpO1xuICAgIH0pKTtcbiAgICAvLyB0ZXN0IGZpbGUgd3JpdGluZyBieSBjcmVhdGluZyBhIHRlc3QgZmlsZSwgdGhlbiB3cml0aW5nIGFkZGl0aW9uYWwgZGF0YSB0byB0aGUgZmlsZSwgYW5kIHJldHVybmluZyBhbnkgZXJyb3IgdGV4dCBpZiBpdCBmYWlsc1xuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiaDNcIiwge1xuICAgICAgdGV4dDogXCJUZXN0IEZpbGUgV3JpdGluZ1wiXG4gICAgfSk7XG4gICAgLy8gbWFudWFsIHNhdmUgYnV0dG9uXG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJoM1wiLCB7XG4gICAgICB0ZXh0OiBcIk1hbnVhbCBTYXZlXCJcbiAgICB9KTtcbiAgICBsZXQgbWFudWFsX3NhdmVfcmVzdWx0cyA9IGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiZGl2XCIpO1xuICAgIG5ldyBPYnNpZGlhbi5TZXR0aW5nKGNvbnRhaW5lckVsKS5zZXROYW1lKFwibWFudWFsX3NhdmVcIikuc2V0RGVzYyhcIlNhdmUgY3VycmVudCBlbWJlZGRpbmdzXCIpLmFkZEJ1dHRvbigoYnV0dG9uKSA9PiBidXR0b24uc2V0QnV0dG9uVGV4dChcIk1hbnVhbCBTYXZlXCIpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gY29uZmlybVxuICAgICAgaWYgKGNvbmZpcm0oXCJBcmUgeW91IHN1cmUgeW91IHdhbnQgdG8gc2F2ZSB5b3VyIGN1cnJlbnQgZW1iZWRkaW5ncz9cIikpIHtcbiAgICAgICAgLy8gc2F2ZVxuICAgICAgICB0cnl7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZV9lbWJlZGRpbmdzX3RvX2ZpbGUodHJ1ZSk7XG4gICAgICAgICAgbWFudWFsX3NhdmVfcmVzdWx0cy5pbm5lckhUTUwgPSBcIkVtYmVkZGluZ3Mgc2F2ZWQgc3VjY2Vzc2Z1bGx5LlwiO1xuICAgICAgICB9Y2F0Y2goZSl7XG4gICAgICAgICAgbWFudWFsX3NhdmVfcmVzdWx0cy5pbm5lckhUTUwgPSBcIkVtYmVkZGluZ3MgZmFpbGVkIHRvIHNhdmUuIEVycm9yOiBcIiArIGU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KSk7XG5cbiAgICAvLyBsaXN0IHByZXZpb3VzbHkgZmFpbGVkIGZpbGVzXG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJoM1wiLCB7XG4gICAgICB0ZXh0OiBcIlByZXZpb3VzbHkgZmFpbGVkIGZpbGVzXCJcbiAgICB9KTtcbiAgICBsZXQgZmFpbGVkX2xpc3QgPSBjb250YWluZXJFbC5jcmVhdGVFbChcImRpdlwiKTtcbiAgICB0aGlzLmRyYXdfZmFpbGVkX2ZpbGVzX2xpc3QoZmFpbGVkX2xpc3QpO1xuXG4gICAgLy8gZm9yY2UgcmVmcmVzaCBidXR0b25cbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcImgzXCIsIHtcbiAgICAgIHRleHQ6IFwiRm9yY2UgUmVmcmVzaFwiXG4gICAgfSk7XG4gICAgbmV3IE9ic2lkaWFuLlNldHRpbmcoY29udGFpbmVyRWwpLnNldE5hbWUoXCJmb3JjZV9yZWZyZXNoXCIpLnNldERlc2MoXCJXQVJOSU5HOiBETyBOT1QgdXNlIHVubGVzcyB5b3Uga25vdyB3aGF0IHlvdSBhcmUgZG9pbmchIFRoaXMgd2lsbCBkZWxldGUgYWxsIG9mIHlvdXIgY3VycmVudCBlbWJlZGRpbmdzIGZyb20gT3BlbkFJIGFuZCB0cmlnZ2VyIHJlcHJvY2Vzc2luZyBvZiB5b3VyIGVudGlyZSB2YXVsdCFcIikuYWRkQnV0dG9uKChidXR0b24pID0+IGJ1dHRvbi5zZXRCdXR0b25UZXh0KFwiRm9yY2UgUmVmcmVzaFwiKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgIC8vIGNvbmZpcm1cbiAgICAgIGlmIChjb25maXJtKFwiQXJlIHlvdSBzdXJlIHlvdSB3YW50IHRvIEZvcmNlIFJlZnJlc2g/IEJ5IGNsaWNraW5nIHllcyB5b3UgY29uZmlybSB0aGF0IHlvdSB1bmRlcnN0YW5kIHRoZSBjb25zZXF1ZW5jZXMgb2YgdGhpcyBhY3Rpb24uXCIpKSB7XG4gICAgICAgIC8vIGZvcmNlIHJlZnJlc2hcbiAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uZm9yY2VfcmVmcmVzaF9lbWJlZGRpbmdzX2ZpbGUoKTtcbiAgICAgIH1cbiAgICB9KSk7XG5cbiAgfVxuICBnZXRfc2VsZl9yZWZfbGlzdCgpIHtcbiAgICByZXR1cm4gXCJDdXJyZW50OiBcIiArIFNNQVJUX1RSQU5TTEFUSU9OW3RoaXMucGx1Z2luLnNldHRpbmdzLmxhbmd1YWdlXS5wcm9ub3VzLmpvaW4oXCIsIFwiKTtcbiAgfVxuXG4gIGRyYXdfZmFpbGVkX2ZpbGVzX2xpc3QoZmFpbGVkX2xpc3QpIHtcbiAgICBmYWlsZWRfbGlzdC5lbXB0eSgpO1xuICAgIGlmKHRoaXMucGx1Z2luLnNldHRpbmdzLmZhaWxlZF9maWxlcy5sZW5ndGggPiAwKSB7XG4gICAgICAvLyBhZGQgbWVzc2FnZSB0aGF0IHRoZXNlIGZpbGVzIHdpbGwgYmUgc2tpcHBlZCB1bnRpbCBtYW51YWxseSByZXRyaWVkXG4gICAgICBmYWlsZWRfbGlzdC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgICB0ZXh0OiBcIlRoZSBmb2xsb3dpbmcgZmlsZXMgZmFpbGVkIHRvIHByb2Nlc3MgYW5kIHdpbGwgYmUgc2tpcHBlZCB1bnRpbCBtYW51YWxseSByZXRyaWVkLlwiXG4gICAgICB9KTtcbiAgICAgIGxldCBsaXN0ID0gZmFpbGVkX2xpc3QuY3JlYXRlRWwoXCJ1bFwiKTtcbiAgICAgIGZvciAobGV0IGZhaWxlZF9maWxlIG9mIHRoaXMucGx1Z2luLnNldHRpbmdzLmZhaWxlZF9maWxlcykge1xuICAgICAgICBsaXN0LmNyZWF0ZUVsKFwibGlcIiwge1xuICAgICAgICAgIHRleHQ6IGZhaWxlZF9maWxlXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgLy8gYWRkIGJ1dHRvbiB0byByZXRyeSBmYWlsZWQgZmlsZXMgb25seVxuICAgICAgbmV3IE9ic2lkaWFuLlNldHRpbmcoZmFpbGVkX2xpc3QpLnNldE5hbWUoXCJyZXRyeV9mYWlsZWRfZmlsZXNcIikuc2V0RGVzYyhcIlJldHJ5IGZhaWxlZCBmaWxlcyBvbmx5XCIpLmFkZEJ1dHRvbigoYnV0dG9uKSA9PiBidXR0b24uc2V0QnV0dG9uVGV4dChcIlJldHJ5IGZhaWxlZCBmaWxlcyBvbmx5XCIpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAvLyBjbGVhciBmYWlsZWRfbGlzdCBlbGVtZW50XG4gICAgICAgIGZhaWxlZF9saXN0LmVtcHR5KCk7XG4gICAgICAgIC8vIHNldCBcInJldHJ5aW5nXCIgdGV4dFxuICAgICAgICBmYWlsZWRfbGlzdC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgICAgIHRleHQ6IFwiUmV0cnlpbmcgZmFpbGVkIGZpbGVzLi4uXCJcbiAgICAgICAgfSk7XG4gICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnJldHJ5X2ZhaWxlZF9maWxlcygpO1xuICAgICAgICAvLyByZWRyYXcgZmFpbGVkIGZpbGVzIGxpc3RcbiAgICAgICAgdGhpcy5kcmF3X2ZhaWxlZF9maWxlc19saXN0KGZhaWxlZF9saXN0KTtcbiAgICAgIH0pKTtcbiAgICB9ZWxzZXtcbiAgICAgIGZhaWxlZF9saXN0LmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICAgIHRleHQ6IFwiTm8gZmFpbGVkIGZpbGVzXCJcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBsaW5lX2lzX2hlYWRpbmcobGluZSkge1xuICByZXR1cm4gKGxpbmUuaW5kZXhPZihcIiNcIikgPT09IDApICYmIChbJyMnLCAnICddLmluZGV4T2YobGluZVsxXSkgIT09IC0xKTtcbn1cblxuY29uc3QgU01BUlRfQ09OTkVDVElPTlNfQ0hBVF9WSUVXX1RZUEUgPSBcInNtYXJ0LWNvbm5lY3Rpb25zLWNoYXQtdmlld1wiO1xuXG5jbGFzcyBTbWFydENvbm5lY3Rpb25zQ2hhdFZpZXcgZXh0ZW5kcyBPYnNpZGlhbi5JdGVtVmlldyB7XG4gIGNvbnN0cnVjdG9yKGxlYWYsIHBsdWdpbikge1xuICAgIHN1cGVyKGxlYWYpO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICAgIHRoaXMuYWN0aXZlX2VsbSA9IG51bGw7XG4gICAgdGhpcy5hY3RpdmVfc3RyZWFtID0gbnVsbDtcbiAgICB0aGlzLmJyYWNrZXRzX2N0ID0gMDtcbiAgICB0aGlzLmNoYXQgPSBudWxsO1xuICAgIHRoaXMuY2hhdF9ib3ggPSBudWxsO1xuICAgIHRoaXMuY2hhdF9jb250YWluZXIgPSBudWxsO1xuICAgIHRoaXMuY3VycmVudF9jaGF0X21sID0gW107XG4gICAgdGhpcy5maWxlcyA9IFtdO1xuICAgIHRoaXMubGFzdF9mcm9tID0gbnVsbDtcbiAgICB0aGlzLm1lc3NhZ2VfY29udGFpbmVyID0gbnVsbDtcbiAgICB0aGlzLnByZXZlbnRfaW5wdXQgPSBmYWxzZTtcbiAgfVxuICBnZXREaXNwbGF5VGV4dCgpIHtcbiAgICByZXR1cm4gXCJTbWFydCBDb25uZWN0aW9ucyBDaGF0XCI7XG4gIH1cbiAgZ2V0SWNvbigpIHtcbiAgICByZXR1cm4gXCJtZXNzYWdlLXNxdWFyZVwiO1xuICB9XG4gIGdldFZpZXdUeXBlKCkge1xuICAgIHJldHVybiBTTUFSVF9DT05ORUNUSU9OU19DSEFUX1ZJRVdfVFlQRTtcbiAgfVxuICBvbk9wZW4oKSB7XG4gICAgdGhpcy5uZXdfY2hhdCgpO1xuICAgIHRoaXMucGx1Z2luLmdldF9hbGxfZm9sZGVycygpOyAvLyBzZXRzIHRoaXMucGx1Z2luLmZvbGRlcnMgbmVjZXNzYXJ5IGZvciBmb2xkZXItY29udGV4dFxuICB9XG4gIG9uQ2xvc2UoKSB7XG4gICAgdGhpcy5jaGF0LnNhdmVfY2hhdCgpO1xuICAgIHRoaXMuYXBwLndvcmtzcGFjZS51bnJlZ2lzdGVySG92ZXJMaW5rU291cmNlKFNNQVJUX0NPTk5FQ1RJT05TX0NIQVRfVklFV19UWVBFKTtcbiAgfVxuICByZW5kZXJfY2hhdCgpIHtcbiAgICB0aGlzLmNvbnRhaW5lckVsLmVtcHR5KCk7XG4gICAgdGhpcy5jaGF0X2NvbnRhaW5lciA9IHRoaXMuY29udGFpbmVyRWwuY3JlYXRlRGl2KFwic2MtY2hhdC1jb250YWluZXJcIik7XG4gICAgLy8gcmVuZGVyIHBsdXMgc2lnbiBmb3IgY2xlYXIgYnV0dG9uXG4gICAgdGhpcy5yZW5kZXJfdG9wX2JhcigpO1xuICAgIC8vIHJlbmRlciBjaGF0IG1lc3NhZ2VzIGNvbnRhaW5lclxuICAgIHRoaXMucmVuZGVyX2NoYXRfYm94KCk7XG4gICAgLy8gcmVuZGVyIGNoYXQgaW5wdXRcbiAgICB0aGlzLnJlbmRlcl9jaGF0X2lucHV0KCk7XG4gICAgdGhpcy5wbHVnaW4ucmVuZGVyX2JyYW5kKHRoaXMuY29udGFpbmVyRWwsIFwiY2hhdFwiKTtcbiAgfVxuICAvLyByZW5kZXIgcGx1cyBzaWduIGZvciBjbGVhciBidXR0b25cbiAgcmVuZGVyX3RvcF9iYXIoKSB7XG4gICAgLy8gY3JlYXRlIGNvbnRhaW5lciBmb3IgY2xlYXIgYnV0dG9uXG4gICAgbGV0IHRvcF9iYXJfY29udGFpbmVyID0gdGhpcy5jaGF0X2NvbnRhaW5lci5jcmVhdGVEaXYoXCJzYy10b3AtYmFyLWNvbnRhaW5lclwiKTtcbiAgICAvLyByZW5kZXIgdGhlIG5hbWUgb2YgdGhlIGNoYXQgaW4gYW4gaW5wdXQgYm94IChwb3AgY29udGVudCBhZnRlciBsYXN0IGh5cGhlbiBpbiBjaGF0X2lkKVxuICAgIGxldCBjaGF0X25hbWUgPXRoaXMuY2hhdC5uYW1lKCk7XG4gICAgbGV0IGNoYXRfbmFtZV9pbnB1dCA9IHRvcF9iYXJfY29udGFpbmVyLmNyZWF0ZUVsKFwiaW5wdXRcIiwge1xuICAgICAgYXR0cjoge1xuICAgICAgICB0eXBlOiBcInRleHRcIixcbiAgICAgICAgdmFsdWU6IGNoYXRfbmFtZVxuICAgICAgfSxcbiAgICAgIGNsczogXCJzYy1jaGF0LW5hbWUtaW5wdXRcIlxuICAgIH0pO1xuICAgIGNoYXRfbmFtZV9pbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsIHRoaXMucmVuYW1lX2NoYXQuYmluZCh0aGlzKSk7XG4gICAgXG4gICAgLy8gY3JlYXRlIGJ1dHRvbiB0byBTbWFydCBWaWV3XG4gICAgbGV0IHNtYXJ0X3ZpZXdfYnRuID0gdGhpcy5jcmVhdGVfdG9wX2Jhcl9idXR0b24odG9wX2Jhcl9jb250YWluZXIsIFwiU21hcnQgVmlld1wiLCBcInNtYXJ0LWNvbm5lY3Rpb25zXCIpO1xuICAgIHNtYXJ0X3ZpZXdfYnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCB0aGlzLm9wZW5fc21hcnRfdmlldy5iaW5kKHRoaXMpKTtcbiAgICAvLyBjcmVhdGUgYnV0dG9uIHRvIHNhdmUgY2hhdFxuICAgIGxldCBzYXZlX2J0biA9IHRoaXMuY3JlYXRlX3RvcF9iYXJfYnV0dG9uKHRvcF9iYXJfY29udGFpbmVyLCBcIlNhdmUgQ2hhdFwiLCBcInNhdmVcIik7XG4gICAgc2F2ZV9idG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIHRoaXMuc2F2ZV9jaGF0LmJpbmQodGhpcykpO1xuICAgIC8vIGNyZWF0ZSBidXR0b24gdG8gb3BlbiBjaGF0IGhpc3RvcnkgbW9kYWxcbiAgICBsZXQgaGlzdG9yeV9idG4gPSB0aGlzLmNyZWF0ZV90b3BfYmFyX2J1dHRvbih0b3BfYmFyX2NvbnRhaW5lciwgXCJDaGF0IEhpc3RvcnlcIiwgXCJoaXN0b3J5XCIpO1xuICAgIGhpc3RvcnlfYnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCB0aGlzLm9wZW5fY2hhdF9oaXN0b3J5LmJpbmQodGhpcykpO1xuICAgIC8vIGNyZWF0ZSBidXR0b24gdG8gc3RhcnQgbmV3IGNoYXRcbiAgICBjb25zdCBuZXdfY2hhdF9idG4gPSB0aGlzLmNyZWF0ZV90b3BfYmFyX2J1dHRvbih0b3BfYmFyX2NvbnRhaW5lciwgXCJOZXcgQ2hhdFwiLCBcInBsdXNcIik7XG4gICAgbmV3X2NoYXRfYnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCB0aGlzLm5ld19jaGF0LmJpbmQodGhpcykpO1xuICB9XG4gIGFzeW5jIG9wZW5fY2hhdF9oaXN0b3J5KCkge1xuICAgIGNvbnN0IGZvbGRlciA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIubGlzdChcIi5zbWFydC1jb25uZWN0aW9ucy9jaGF0c1wiKTtcbiAgICB0aGlzLmZpbGVzID0gZm9sZGVyLmZpbGVzLm1hcCgoZmlsZSkgPT4ge1xuICAgICAgcmV0dXJuIGZpbGUucmVwbGFjZShcIi5zbWFydC1jb25uZWN0aW9ucy9jaGF0cy9cIiwgXCJcIikucmVwbGFjZShcIi5qc29uXCIsIFwiXCIpO1xuICAgIH0pO1xuICAgIC8vIG9wZW4gY2hhdCBoaXN0b3J5IG1vZGFsXG4gICAgaWYgKCF0aGlzLm1vZGFsKVxuICAgICAgdGhpcy5tb2RhbCA9IG5ldyBTbWFydENvbm5lY3Rpb25zQ2hhdEhpc3RvcnlNb2RhbCh0aGlzLmFwcCwgdGhpcyk7XG4gICAgdGhpcy5tb2RhbC5vcGVuKCk7XG4gIH1cblxuICBjcmVhdGVfdG9wX2Jhcl9idXR0b24odG9wX2Jhcl9jb250YWluZXIsIHRpdGxlLCBpY29uPW51bGwpIHtcbiAgICBsZXQgYnRuID0gdG9wX2Jhcl9jb250YWluZXIuY3JlYXRlRWwoXCJidXR0b25cIiwge1xuICAgICAgYXR0cjoge1xuICAgICAgICB0aXRsZTogdGl0bGVcbiAgICAgIH1cbiAgICB9KTtcbiAgICBpZihpY29uKXtcbiAgICAgIE9ic2lkaWFuLnNldEljb24oYnRuLCBpY29uKTtcbiAgICB9ZWxzZXtcbiAgICAgIGJ0bi5pbm5lckhUTUwgPSB0aXRsZTtcbiAgICB9XG4gICAgcmV0dXJuIGJ0bjtcbiAgfVxuICAvLyByZW5kZXIgbmV3IGNoYXRcbiAgbmV3X2NoYXQoKSB7XG4gICAgdGhpcy5jbGVhcl9jaGF0KCk7XG4gICAgdGhpcy5yZW5kZXJfY2hhdCgpO1xuICAgIC8vIHJlbmRlciBpbml0aWFsIG1lc3NhZ2UgZnJvbSBhc3Npc3RhbnQgKGRvbid0IHVzZSByZW5kZXJfbWVzc2FnZSB0byBza2lwIGFkZGluZyB0byBjaGF0IGhpc3RvcnkpXG4gICAgdGhpcy5uZXdfbWVzc3NhZ2VfYnViYmxlKFwiYXNzaXN0YW50XCIpO1xuICAgIHRoaXMuYWN0aXZlX2VsbS5pbm5lckhUTUwgPSAnPHA+JyArIFNNQVJUX1RSQU5TTEFUSU9OW3RoaXMucGx1Z2luLnNldHRpbmdzLmxhbmd1YWdlXS5pbml0aWFsX21lc3NhZ2UrJzwvcD4nO1xuICB9XG4gIC8vIG9wZW4gYSBjaGF0IGZyb20gdGhlIGNoYXQgaGlzdG9yeSBtb2RhbFxuICBhc3luYyBvcGVuX2NoYXQoY2hhdF9pZCkge1xuICAgIHRoaXMuY2xlYXJfY2hhdCgpO1xuICAgIGF3YWl0IHRoaXMuY2hhdC5sb2FkX2NoYXQoY2hhdF9pZCk7XG4gICAgdGhpcy5yZW5kZXJfY2hhdCgpO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhpcy5jaGF0LmNoYXRfbWwubGVuZ3RoOyBpKyspIHtcbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyX21lc3NhZ2UodGhpcy5jaGF0LmNoYXRfbWxbaV0uY29udGVudCwgdGhpcy5jaGF0LmNoYXRfbWxbaV0ucm9sZSk7XG4gICAgfVxuICB9XG4gIC8vIGNsZWFyIGN1cnJlbnQgY2hhdCBzdGF0ZVxuICBjbGVhcl9jaGF0KCkge1xuICAgIGlmICh0aGlzLmNoYXQpIHtcbiAgICAgIHRoaXMuY2hhdC5zYXZlX2NoYXQoKTtcbiAgICB9XG4gICAgdGhpcy5jaGF0ID0gbmV3IFNtYXJ0Q29ubmVjdGlvbnNDaGF0TW9kZWwodGhpcy5wbHVnaW4pO1xuICAgIC8vIGlmIHRoaXMuZG90ZG90ZG90X2ludGVydmFsIGlzIG5vdCBudWxsLCBjbGVhciBpbnRlcnZhbFxuICAgIGlmICh0aGlzLmRvdGRvdGRvdF9pbnRlcnZhbCkge1xuICAgICAgY2xlYXJJbnRlcnZhbCh0aGlzLmRvdGRvdGRvdF9pbnRlcnZhbCk7XG4gICAgfVxuICAgIC8vIGNsZWFyIGN1cnJlbnQgY2hhdCBtbFxuICAgIHRoaXMuY3VycmVudF9jaGF0X21sID0gW107XG4gICAgLy8gdXBkYXRlIHByZXZlbnQgaW5wdXRcbiAgICB0aGlzLmVuZF9zdHJlYW0oKTtcbiAgfVxuXG4gIHJlbmFtZV9jaGF0KGV2ZW50KSB7XG4gICAgbGV0IG5ld19jaGF0X25hbWUgPSBldmVudC50YXJnZXQudmFsdWU7XG4gICAgdGhpcy5jaGF0LnJlbmFtZV9jaGF0KG5ld19jaGF0X25hbWUpO1xuICB9XG4gIFxuICAvLyBzYXZlIGN1cnJlbnQgY2hhdFxuICBzYXZlX2NoYXQoKSB7XG4gICAgdGhpcy5jaGF0LnNhdmVfY2hhdCgpO1xuICAgIG5ldyBPYnNpZGlhbi5Ob3RpY2UoXCJbU21hcnQgQ29ubmVjdGlvbnNdIENoYXQgc2F2ZWRcIik7XG4gIH1cbiAgXG4gIG9wZW5fc21hcnRfdmlldygpIHtcbiAgICB0aGlzLnBsdWdpbi5vcGVuX3ZpZXcoKTtcbiAgfVxuICAvLyByZW5kZXIgY2hhdCBtZXNzYWdlcyBjb250YWluZXJcbiAgcmVuZGVyX2NoYXRfYm94KCkge1xuICAgIC8vIGNyZWF0ZSBjb250YWluZXIgZm9yIGNoYXQgbWVzc2FnZXNcbiAgICB0aGlzLmNoYXRfYm94ID0gdGhpcy5jaGF0X2NvbnRhaW5lci5jcmVhdGVEaXYoXCJzYy1jaGF0LWJveFwiKTtcbiAgICAvLyBjcmVhdGUgY29udGFpbmVyIGZvciBtZXNzYWdlXG4gICAgdGhpcy5tZXNzYWdlX2NvbnRhaW5lciA9IHRoaXMuY2hhdF9ib3guY3JlYXRlRGl2KFwic2MtbWVzc2FnZS1jb250YWluZXJcIik7XG4gIH1cbiAgLy8gb3BlbiBmaWxlIHN1Z2dlc3Rpb24gbW9kYWxcbiAgb3Blbl9maWxlX3N1Z2dlc3Rpb25fbW9kYWwoKSB7XG4gICAgLy8gb3BlbiBmaWxlIHN1Z2dlc3Rpb24gbW9kYWxcbiAgICBpZighdGhpcy5maWxlX3NlbGVjdG9yKSB0aGlzLmZpbGVfc2VsZWN0b3IgPSBuZXcgU21hcnRDb25uZWN0aW9uc0ZpbGVTZWxlY3RNb2RhbCh0aGlzLmFwcCwgdGhpcyk7XG4gICAgdGhpcy5maWxlX3NlbGVjdG9yLm9wZW4oKTtcbiAgfVxuICAvLyBvcGVuIGZvbGRlciBzdWdnZXN0aW9uIG1vZGFsXG4gIGFzeW5jIG9wZW5fZm9sZGVyX3N1Z2dlc3Rpb25fbW9kYWwoKSB7XG4gICAgLy8gb3BlbiBmb2xkZXIgc3VnZ2VzdGlvbiBtb2RhbFxuICAgIGlmKCF0aGlzLmZvbGRlcl9zZWxlY3Rvcil7XG4gICAgICB0aGlzLmZvbGRlcl9zZWxlY3RvciA9IG5ldyBTbWFydENvbm5lY3Rpb25zRm9sZGVyU2VsZWN0TW9kYWwodGhpcy5hcHAsIHRoaXMpO1xuICAgIH1cbiAgICB0aGlzLmZvbGRlcl9zZWxlY3Rvci5vcGVuKCk7XG4gIH1cbiAgLy8gaW5zZXJ0X3NlbGVjdGlvbiBmcm9tIGZpbGUgc3VnZ2VzdGlvbiBtb2RhbFxuICBpbnNlcnRfc2VsZWN0aW9uKGluc2VydF90ZXh0KSB7XG4gICAgLy8gZ2V0IGNhcmV0IHBvc2l0aW9uXG4gICAgbGV0IGNhcmV0X3BvcyA9IHRoaXMudGV4dGFyZWEuc2VsZWN0aW9uU3RhcnQ7XG4gICAgLy8gZ2V0IHRleHQgYmVmb3JlIGNhcmV0XG4gICAgbGV0IHRleHRfYmVmb3JlID0gdGhpcy50ZXh0YXJlYS52YWx1ZS5zdWJzdHJpbmcoMCwgY2FyZXRfcG9zKTtcbiAgICAvLyBnZXQgdGV4dCBhZnRlciBjYXJldFxuICAgIGxldCB0ZXh0X2FmdGVyID0gdGhpcy50ZXh0YXJlYS52YWx1ZS5zdWJzdHJpbmcoY2FyZXRfcG9zLCB0aGlzLnRleHRhcmVhLnZhbHVlLmxlbmd0aCk7XG4gICAgLy8gaW5zZXJ0IHRleHRcbiAgICB0aGlzLnRleHRhcmVhLnZhbHVlID0gdGV4dF9iZWZvcmUgKyBpbnNlcnRfdGV4dCArIHRleHRfYWZ0ZXI7XG4gICAgLy8gc2V0IGNhcmV0IHBvc2l0aW9uXG4gICAgdGhpcy50ZXh0YXJlYS5zZWxlY3Rpb25TdGFydCA9IGNhcmV0X3BvcyArIGluc2VydF90ZXh0Lmxlbmd0aDtcbiAgICB0aGlzLnRleHRhcmVhLnNlbGVjdGlvbkVuZCA9IGNhcmV0X3BvcyArIGluc2VydF90ZXh0Lmxlbmd0aDtcbiAgICAvLyBmb2N1cyBvbiB0ZXh0YXJlYVxuICAgIHRoaXMudGV4dGFyZWEuZm9jdXMoKTtcbiAgfVxuXG4gIC8vIHJlbmRlciBjaGF0IHRleHRhcmVhIGFuZCBidXR0b25cbiAgcmVuZGVyX2NoYXRfaW5wdXQoKSB7XG4gICAgLy8gY3JlYXRlIGNvbnRhaW5lciBmb3IgY2hhdCBpbnB1dFxuICAgIGxldCBjaGF0X2lucHV0ID0gdGhpcy5jaGF0X2NvbnRhaW5lci5jcmVhdGVEaXYoXCJzYy1jaGF0LWZvcm1cIik7XG4gICAgLy8gY3JlYXRlIHRleHRhcmVhXG4gICAgdGhpcy50ZXh0YXJlYSA9IGNoYXRfaW5wdXQuY3JlYXRlRWwoXCJ0ZXh0YXJlYVwiLCB7XG4gICAgICBjbHM6IFwic2MtY2hhdC1pbnB1dFwiLFxuICAgICAgYXR0cjoge1xuICAgICAgICBwbGFjZWhvbGRlcjogYFRyeSBcIkJhc2VkIG9uIG15IG5vdGVzXCIgb3IgXCJTdW1tYXJpemUgW1t0aGlzIG5vdGVdXVwiIG9yIFwiSW1wb3J0YW50IHRhc2tzIGluIC9mb2xkZXIvXCJgXG4gICAgICB9XG4gICAgfSk7XG4gICAgLy8gdXNlIGNvbnRlbnRlZGl0YWJsZSBpbnN0ZWFkIG9mIHRleHRhcmVhXG4gICAgLy8gdGhpcy50ZXh0YXJlYSA9IGNoYXRfaW5wdXQuY3JlYXRlRWwoXCJkaXZcIiwge2NsczogXCJzYy1jaGF0LWlucHV0XCIsIGF0dHI6IHtjb250ZW50ZWRpdGFibGU6IHRydWV9fSk7XG4gICAgLy8gYWRkIGV2ZW50IGxpc3RlbmVyIHRvIGxpc3RlbiBmb3Igc2hpZnQrZW50ZXJcbiAgICBjaGF0X2lucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJrZXl1cFwiLCAoZSkgPT4ge1xuICAgICAgaWYoW1wiW1wiLCBcIi9cIl0uaW5kZXhPZihlLmtleSkgPT09IC0xKSByZXR1cm47IC8vIHNraXAgaWYga2V5IGlzIG5vdCBbIG9yIC9cbiAgICAgIGNvbnN0IGNhcmV0X3BvcyA9IHRoaXMudGV4dGFyZWEuc2VsZWN0aW9uU3RhcnQ7XG4gICAgICAvLyBpZiBrZXkgaXMgb3BlbiBzcXVhcmUgYnJhY2tldFxuICAgICAgaWYgKGUua2V5ID09PSBcIltcIikge1xuICAgICAgICAvLyBpZiBwcmV2aW91cyBjaGFyIGlzIFtcbiAgICAgICAgaWYodGhpcy50ZXh0YXJlYS52YWx1ZVtjYXJldF9wb3MgLSAyXSA9PT0gXCJbXCIpe1xuICAgICAgICAgIC8vIG9wZW4gZmlsZSBzdWdnZXN0aW9uIG1vZGFsXG4gICAgICAgICAgdGhpcy5vcGVuX2ZpbGVfc3VnZ2VzdGlvbl9tb2RhbCgpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgfWVsc2V7XG4gICAgICAgIHRoaXMuYnJhY2tldHNfY3QgPSAwO1xuICAgICAgfVxuICAgICAgLy8gaWYgLyBpcyBwcmVzc2VkXG4gICAgICBpZiAoZS5rZXkgPT09IFwiL1wiKSB7XG4gICAgICAgIC8vIGdldCBjYXJldCBwb3NpdGlvblxuICAgICAgICAvLyBpZiB0aGlzIGlzIGZpcnN0IGNoYXIgb3IgcHJldmlvdXMgY2hhciBpcyBzcGFjZVxuICAgICAgICBpZiAodGhpcy50ZXh0YXJlYS52YWx1ZS5sZW5ndGggPT09IDEgfHwgdGhpcy50ZXh0YXJlYS52YWx1ZVtjYXJldF9wb3MgLSAyXSA9PT0gXCIgXCIpIHtcbiAgICAgICAgICAvLyBvcGVuIGZvbGRlciBzdWdnZXN0aW9uIG1vZGFsXG4gICAgICAgICAgdGhpcy5vcGVuX2ZvbGRlcl9zdWdnZXN0aW9uX21vZGFsKCk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICB9KTtcblxuICAgIGNoYXRfaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGUpID0+IHtcbiAgICAgIGlmIChlLmtleSA9PT0gXCJFbnRlclwiICYmIGUuc2hpZnRLZXkpIHtcbiAgICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBpZih0aGlzLnByZXZlbnRfaW5wdXQpe1xuICAgICAgICAgIGNvbnNvbGUubG9nKFwid2FpdCB1bnRpbCBjdXJyZW50IHJlc3BvbnNlIGlzIGZpbmlzaGVkXCIpO1xuICAgICAgICAgIG5ldyBPYnNpZGlhbi5Ob3RpY2UoXCJbU21hcnQgQ29ubmVjdGlvbnNdIFdhaXQgdW50aWwgY3VycmVudCByZXNwb25zZSBpcyBmaW5pc2hlZFwiKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgLy8gZ2V0IHRleHQgZnJvbSB0ZXh0YXJlYVxuICAgICAgICBsZXQgdXNlcl9pbnB1dCA9IHRoaXMudGV4dGFyZWEudmFsdWU7XG4gICAgICAgIC8vIGNsZWFyIHRleHRhcmVhXG4gICAgICAgIHRoaXMudGV4dGFyZWEudmFsdWUgPSBcIlwiO1xuICAgICAgICAvLyBpbml0aWF0ZSByZXNwb25zZSBmcm9tIGFzc2lzdGFudFxuICAgICAgICB0aGlzLmluaXRpYWxpemVfcmVzcG9uc2UodXNlcl9pbnB1dCk7XG4gICAgICB9XG4gICAgICB0aGlzLnRleHRhcmVhLnN0eWxlLmhlaWdodCA9ICdhdXRvJztcbiAgICAgIHRoaXMudGV4dGFyZWEuc3R5bGUuaGVpZ2h0ID0gKHRoaXMudGV4dGFyZWEuc2Nyb2xsSGVpZ2h0KSArICdweCc7XG4gICAgfSk7XG4gICAgLy8gYnV0dG9uIGNvbnRhaW5lclxuICAgIGxldCBidXR0b25fY29udGFpbmVyID0gY2hhdF9pbnB1dC5jcmVhdGVEaXYoXCJzYy1idXR0b24tY29udGFpbmVyXCIpO1xuICAgIC8vIGNyZWF0ZSBoaWRkZW4gYWJvcnQgYnV0dG9uXG4gICAgbGV0IGFib3J0X2J1dHRvbiA9IGJ1dHRvbl9jb250YWluZXIuY3JlYXRlRWwoXCJzcGFuXCIsIHsgYXR0cjoge2lkOiBcInNjLWFib3J0LWJ1dHRvblwiLCBzdHlsZTogXCJkaXNwbGF5OiBub25lO1wifSB9KTtcbiAgICBPYnNpZGlhbi5zZXRJY29uKGFib3J0X2J1dHRvbiwgXCJzcXVhcmVcIik7XG4gICAgLy8gYWRkIGV2ZW50IGxpc3RlbmVyIHRvIGJ1dHRvblxuICAgIGFib3J0X2J1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgLy8gYWJvcnQgY3VycmVudCByZXNwb25zZVxuICAgICAgdGhpcy5lbmRfc3RyZWFtKCk7XG4gICAgfSk7XG4gICAgLy8gY3JlYXRlIGJ1dHRvblxuICAgIGxldCBidXR0b24gPSBidXR0b25fY29udGFpbmVyLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgYXR0cjoge2lkOiBcInNjLXNlbmQtYnV0dG9uXCJ9LCBjbHM6IFwic2VuZC1idXR0b25cIiB9KTtcbiAgICBidXR0b24uaW5uZXJIVE1MID0gXCJTZW5kXCI7XG4gICAgLy8gYWRkIGV2ZW50IGxpc3RlbmVyIHRvIGJ1dHRvblxuICAgIGJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgaWYodGhpcy5wcmV2ZW50X2lucHV0KXtcbiAgICAgICAgY29uc29sZS5sb2coXCJ3YWl0IHVudGlsIGN1cnJlbnQgcmVzcG9uc2UgaXMgZmluaXNoZWRcIik7XG4gICAgICAgIG5ldyBPYnNpZGlhbi5Ob3RpY2UoXCJXYWl0IHVudGlsIGN1cnJlbnQgcmVzcG9uc2UgaXMgZmluaXNoZWRcIik7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIC8vIGdldCB0ZXh0IGZyb20gdGV4dGFyZWFcbiAgICAgIGxldCB1c2VyX2lucHV0ID0gdGhpcy50ZXh0YXJlYS52YWx1ZTtcbiAgICAgIC8vIGNsZWFyIHRleHRhcmVhXG4gICAgICB0aGlzLnRleHRhcmVhLnZhbHVlID0gXCJcIjtcbiAgICAgIC8vIGluaXRpYXRlIHJlc3BvbnNlIGZyb20gYXNzaXN0YW50XG4gICAgICB0aGlzLmluaXRpYWxpemVfcmVzcG9uc2UodXNlcl9pbnB1dCk7XG4gICAgfSk7XG4gIH1cbiAgYXN5bmMgaW5pdGlhbGl6ZV9yZXNwb25zZSh1c2VyX2lucHV0KSB7XG4gICAgdGhpcy5zZXRfc3RyZWFtaW5nX3V4KCk7XG4gICAgLy8gcmVuZGVyIG1lc3NhZ2VcbiAgICBhd2FpdCB0aGlzLnJlbmRlcl9tZXNzYWdlKHVzZXJfaW5wdXQsIFwidXNlclwiKTtcbiAgICB0aGlzLmNoYXQubmV3X21lc3NhZ2VfaW5fdGhyZWFkKHtcbiAgICAgIHJvbGU6IFwidXNlclwiLFxuICAgICAgY29udGVudDogdXNlcl9pbnB1dFxuICAgIH0pO1xuICAgIGF3YWl0IHRoaXMucmVuZGVyX2RvdGRvdGRvdCgpO1xuXG4gICAgLy8gaWYgY29udGFpbnMgaW50ZXJuYWwgbGluayByZXByZXNlbnRlZCBieSBbW2xpbmtdXVxuICAgIGlmKHRoaXMuY2hhdC5jb250YWluc19pbnRlcm5hbF9saW5rKHVzZXJfaW5wdXQpKSB7XG4gICAgICB0aGlzLmNoYXQuZ2V0X3Jlc3BvbnNlX3dpdGhfbm90ZV9jb250ZXh0KHVzZXJfaW5wdXQsIHRoaXMpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICAvLyAvLyBmb3IgdGVzdGluZyBwdXJwb3Nlc1xuICAgIC8vIGlmKHRoaXMuY2hhdC5jb250YWluc19mb2xkZXJfcmVmZXJlbmNlKHVzZXJfaW5wdXQpKSB7XG4gICAgLy8gICBjb25zdCBmb2xkZXJzID0gdGhpcy5jaGF0LmdldF9mb2xkZXJfcmVmZXJlbmNlcyh1c2VyX2lucHV0KTtcbiAgICAvLyAgIGNvbnNvbGUubG9nKGZvbGRlcnMpO1xuICAgIC8vICAgcmV0dXJuO1xuICAgIC8vIH1cbiAgICAvLyBpZiBjb250YWlucyBzZWxmIHJlZmVyZW50aWFsIGtleXdvcmRzIG9yIGZvbGRlciByZWZlcmVuY2VcbiAgICBpZih0aGlzLmNvbnRhaW5zX3NlbGZfcmVmZXJlbnRpYWxfa2V5d29yZHModXNlcl9pbnB1dCkgfHwgdGhpcy5jaGF0LmNvbnRhaW5zX2ZvbGRlcl9yZWZlcmVuY2UodXNlcl9pbnB1dCkpIHtcbiAgICAgIC8vIGdldCBoeWRlXG4gICAgICBjb25zdCBjb250ZXh0ID0gYXdhaXQgdGhpcy5nZXRfY29udGV4dF9oeWRlKHVzZXJfaW5wdXQpO1xuICAgICAgLy8gZ2V0IHVzZXIgaW5wdXQgd2l0aCBhZGRlZCBjb250ZXh0XG4gICAgICAvLyBjb25zdCBjb250ZXh0X2lucHV0ID0gdGhpcy5idWlsZF9jb250ZXh0X2lucHV0KGNvbnRleHQpO1xuICAgICAgLy8gY29uc29sZS5sb2coY29udGV4dF9pbnB1dCk7XG4gICAgICBjb25zdCBjaGF0bWwgPSBbXG4gICAgICAgIHtcbiAgICAgICAgICByb2xlOiBcInN5c3RlbVwiLFxuICAgICAgICAgIC8vIGNvbnRlbnQ6IGNvbnRleHRfaW5wdXRcbiAgICAgICAgICBjb250ZW50OiBjb250ZXh0XG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICByb2xlOiBcInVzZXJcIixcbiAgICAgICAgICBjb250ZW50OiB1c2VyX2lucHV0XG4gICAgICAgIH1cbiAgICAgIF07XG4gICAgICB0aGlzLnJlcXVlc3RfY2hhdGdwdF9jb21wbGV0aW9uKHttZXNzYWdlczogY2hhdG1sLCB0ZW1wZXJhdHVyZTogMH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICAvLyBjb21wbGV0aW9uIHdpdGhvdXQgYW55IHNwZWNpZmljIGNvbnRleHRcbiAgICB0aGlzLnJlcXVlc3RfY2hhdGdwdF9jb21wbGV0aW9uKCk7XG4gIH1cbiAgXG4gIGFzeW5jIHJlbmRlcl9kb3Rkb3Rkb3QoKSB7XG4gICAgaWYgKHRoaXMuZG90ZG90ZG90X2ludGVydmFsKVxuICAgICAgY2xlYXJJbnRlcnZhbCh0aGlzLmRvdGRvdGRvdF9pbnRlcnZhbCk7XG4gICAgYXdhaXQgdGhpcy5yZW5kZXJfbWVzc2FnZShcIi4uLlwiLCBcImFzc2lzdGFudFwiKTtcbiAgICAvLyBpZiBpcyAnLi4uJywgdGhlbiBpbml0aWF0ZSBpbnRlcnZhbCB0byBjaGFuZ2UgdG8gJy4nIGFuZCB0aGVuIHRvICcuLicgYW5kIHRoZW4gdG8gJy4uLidcbiAgICBsZXQgZG90cyA9IDA7XG4gICAgdGhpcy5hY3RpdmVfZWxtLmlubmVySFRNTCA9ICcuLi4nO1xuICAgIHRoaXMuZG90ZG90ZG90X2ludGVydmFsID0gc2V0SW50ZXJ2YWwoKCkgPT4ge1xuICAgICAgZG90cysrO1xuICAgICAgaWYgKGRvdHMgPiAzKVxuICAgICAgICBkb3RzID0gMTtcbiAgICAgIHRoaXMuYWN0aXZlX2VsbS5pbm5lckhUTUwgPSAnLicucmVwZWF0KGRvdHMpO1xuICAgIH0sIDUwMCk7XG4gICAgLy8gd2FpdCAyIHNlY29uZHMgZm9yIHRlc3RpbmdcbiAgICAvLyBhd2FpdCBuZXcgUHJvbWlzZShyID0+IHNldFRpbWVvdXQociwgMjAwMCkpO1xuICB9XG5cbiAgc2V0X3N0cmVhbWluZ191eCgpIHtcbiAgICB0aGlzLnByZXZlbnRfaW5wdXQgPSB0cnVlO1xuICAgIC8vIGhpZGUgc2VuZCBidXR0b25cbiAgICBpZihkb2N1bWVudC5nZXRFbGVtZW50QnlJZChcInNjLXNlbmQtYnV0dG9uXCIpKVxuICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXCJzYy1zZW5kLWJ1dHRvblwiKS5zdHlsZS5kaXNwbGF5ID0gXCJub25lXCI7XG4gICAgLy8gc2hvdyBhYm9ydCBidXR0b25cbiAgICBpZihkb2N1bWVudC5nZXRFbGVtZW50QnlJZChcInNjLWFib3J0LWJ1dHRvblwiKSlcbiAgICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKFwic2MtYWJvcnQtYnV0dG9uXCIpLnN0eWxlLmRpc3BsYXkgPSBcImJsb2NrXCI7XG4gIH1cbiAgdW5zZXRfc3RyZWFtaW5nX3V4KCkge1xuICAgIHRoaXMucHJldmVudF9pbnB1dCA9IGZhbHNlO1xuICAgIC8vIHNob3cgc2VuZCBidXR0b24sIHJlbW92ZSBkaXNwbGF5IG5vbmVcbiAgICBpZihkb2N1bWVudC5nZXRFbGVtZW50QnlJZChcInNjLXNlbmQtYnV0dG9uXCIpKVxuICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXCJzYy1zZW5kLWJ1dHRvblwiKS5zdHlsZS5kaXNwbGF5ID0gXCJcIjtcbiAgICAvLyBoaWRlIGFib3J0IGJ1dHRvblxuICAgIGlmKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKFwic2MtYWJvcnQtYnV0dG9uXCIpKVxuICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoXCJzYy1hYm9ydC1idXR0b25cIikuc3R5bGUuZGlzcGxheSA9IFwibm9uZVwiO1xuICB9XG5cblxuICAvLyBjaGVjayBpZiBpbmNsdWRlcyBrZXl3b3JkcyByZWZlcnJpbmcgdG8gb25lJ3Mgb3duIG5vdGVzXG4gIGNvbnRhaW5zX3NlbGZfcmVmZXJlbnRpYWxfa2V5d29yZHModXNlcl9pbnB1dCkge1xuICAgIGNvbnN0IG1hdGNoZXMgPSB1c2VyX2lucHV0Lm1hdGNoKHRoaXMucGx1Z2luLnNlbGZfcmVmX2t3X3JlZ2V4KTtcbiAgICBpZihtYXRjaGVzKSByZXR1cm4gdHJ1ZTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICAvLyByZW5kZXIgbWVzc2FnZVxuICBhc3luYyByZW5kZXJfbWVzc2FnZShtZXNzYWdlLCBmcm9tPVwiYXNzaXN0YW50XCIsIGFwcGVuZF9sYXN0PWZhbHNlKSB7XG4gICAgLy8gaWYgZG90ZG90ZG90IGludGVydmFsIGlzIHNldCwgdGhlbiBjbGVhciBpdFxuICAgIGlmKHRoaXMuZG90ZG90ZG90X2ludGVydmFsKSB7XG4gICAgICBjbGVhckludGVydmFsKHRoaXMuZG90ZG90ZG90X2ludGVydmFsKTtcbiAgICAgIHRoaXMuZG90ZG90ZG90X2ludGVydmFsID0gbnVsbDtcbiAgICAgIC8vIGNsZWFyIGxhc3QgbWVzc2FnZVxuICAgICAgdGhpcy5hY3RpdmVfZWxtLmlubmVySFRNTCA9ICcnO1xuICAgIH1cbiAgICBpZihhcHBlbmRfbGFzdCkge1xuICAgICAgdGhpcy5jdXJyZW50X21lc3NhZ2VfcmF3ICs9IG1lc3NhZ2U7XG4gICAgICBpZihtZXNzYWdlLmluZGV4T2YoJ1xcbicpID09PSAtMSkge1xuICAgICAgICB0aGlzLmFjdGl2ZV9lbG0uaW5uZXJIVE1MICs9IG1lc3NhZ2U7XG4gICAgICB9ZWxzZXtcbiAgICAgICAgdGhpcy5hY3RpdmVfZWxtLmlubmVySFRNTCA9ICcnO1xuICAgICAgICAvLyBhcHBlbmQgdG8gbGFzdCBtZXNzYWdlXG4gICAgICAgIGF3YWl0IE9ic2lkaWFuLk1hcmtkb3duUmVuZGVyZXIucmVuZGVyTWFya2Rvd24odGhpcy5jdXJyZW50X21lc3NhZ2VfcmF3LCB0aGlzLmFjdGl2ZV9lbG0sICc/bm8tZGF0YXZpZXcnLCBuZXcgT2JzaWRpYW4uQ29tcG9uZW50KCkpO1xuICAgICAgfVxuICAgIH1lbHNle1xuICAgICAgdGhpcy5jdXJyZW50X21lc3NhZ2VfcmF3ID0gJyc7XG4gICAgICBpZigodGhpcy5jaGF0LnRocmVhZC5sZW5ndGggPT09IDApIHx8ICh0aGlzLmxhc3RfZnJvbSAhPT0gZnJvbSkpIHtcbiAgICAgICAgLy8gY3JlYXRlIG1lc3NhZ2VcbiAgICAgICAgdGhpcy5uZXdfbWVzc3NhZ2VfYnViYmxlKGZyb20pO1xuICAgICAgfVxuICAgICAgLy8gc2V0IG1lc3NhZ2UgdGV4dFxuICAgICAgdGhpcy5hY3RpdmVfZWxtLmlubmVySFRNTCA9ICcnO1xuICAgICAgYXdhaXQgT2JzaWRpYW4uTWFya2Rvd25SZW5kZXJlci5yZW5kZXJNYXJrZG93bihtZXNzYWdlLCB0aGlzLmFjdGl2ZV9lbG0sICc/bm8tZGF0YXZpZXcnLCBuZXcgT2JzaWRpYW4uQ29tcG9uZW50KCkpO1xuICAgICAgLy8gZ2V0IGxpbmtzXG4gICAgICB0aGlzLmhhbmRsZV9saW5rc19pbl9tZXNzYWdlKCk7XG4gICAgICAvLyByZW5kZXIgYnV0dG9uKHMpXG4gICAgICB0aGlzLnJlbmRlcl9tZXNzYWdlX2FjdGlvbl9idXR0b25zKG1lc3NhZ2UpO1xuICAgIH1cbiAgICAvLyBzY3JvbGwgdG8gYm90dG9tXG4gICAgdGhpcy5tZXNzYWdlX2NvbnRhaW5lci5zY3JvbGxUb3AgPSB0aGlzLm1lc3NhZ2VfY29udGFpbmVyLnNjcm9sbEhlaWdodDtcbiAgfVxuICByZW5kZXJfbWVzc2FnZV9hY3Rpb25fYnV0dG9ucyhtZXNzYWdlKSB7XG4gICAgaWYgKHRoaXMuY2hhdC5jb250ZXh0ICYmIHRoaXMuY2hhdC5oeWQpIHtcbiAgICAgIC8vIHJlbmRlciBidXR0b24gdG8gY29weSBoeWQgaW4gc21hcnQtY29ubmVjdGlvbnMgY29kZSBibG9ja1xuICAgICAgY29uc3QgY29udGV4dF92aWV3ID0gdGhpcy5hY3RpdmVfZWxtLmNyZWF0ZUVsKFwic3BhblwiLCB7XG4gICAgICAgIGNsczogXCJzYy1tc2ctYnV0dG9uXCIsXG4gICAgICAgIGF0dHI6IHtcbiAgICAgICAgICB0aXRsZTogXCJDb3B5IGNvbnRleHQgdG8gY2xpcGJvYXJkXCIgLyogdG9vbHRpcCAqL1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIGNvbnN0IHRoaXNfaHlkID0gdGhpcy5jaGF0Lmh5ZDtcbiAgICAgIE9ic2lkaWFuLnNldEljb24oY29udGV4dF92aWV3LCBcImV5ZVwiKTtcbiAgICAgIGNvbnRleHRfdmlldy5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgICAvLyBjb3B5IHRvIGNsaXBib2FyZFxuICAgICAgICBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dChcImBgYHNtYXJ0LWNvbm5lY3Rpb25zXFxuXCIgKyB0aGlzX2h5ZCArIFwiXFxuYGBgXFxuXCIpO1xuICAgICAgICBuZXcgT2JzaWRpYW4uTm90aWNlKFwiW1NtYXJ0IENvbm5lY3Rpb25zXSBDb250ZXh0IGNvZGUgYmxvY2sgY29waWVkIHRvIGNsaXBib2FyZFwiKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICBpZih0aGlzLmNoYXQuY29udGV4dCkge1xuICAgICAgLy8gcmVuZGVyIGNvcHkgY29udGV4dCBidXR0b25cbiAgICAgIGNvbnN0IGNvcHlfcHJvbXB0X2J1dHRvbiA9IHRoaXMuYWN0aXZlX2VsbS5jcmVhdGVFbChcInNwYW5cIiwge1xuICAgICAgICBjbHM6IFwic2MtbXNnLWJ1dHRvblwiLFxuICAgICAgICBhdHRyOiB7XG4gICAgICAgICAgdGl0bGU6IFwiQ29weSBwcm9tcHQgdG8gY2xpcGJvYXJkXCIgLyogdG9vbHRpcCAqL1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIGNvbnN0IHRoaXNfY29udGV4dCA9IHRoaXMuY2hhdC5jb250ZXh0LnJlcGxhY2UoL1xcYFxcYFxcYC9nLCBcIlxcdGBgYFwiKS50cmltTGVmdCgpO1xuICAgICAgT2JzaWRpYW4uc2V0SWNvbihjb3B5X3Byb21wdF9idXR0b24sIFwiZmlsZXNcIik7XG4gICAgICBjb3B5X3Byb21wdF9idXR0b24uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgICAgLy8gY29weSB0byBjbGlwYm9hcmRcbiAgICAgICAgbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZVRleHQoXCJgYGBwcm9tcHQtY29udGV4dFxcblwiICsgdGhpc19jb250ZXh0ICsgXCJcXG5gYGBcXG5cIik7XG4gICAgICAgIG5ldyBPYnNpZGlhbi5Ob3RpY2UoXCJbU21hcnQgQ29ubmVjdGlvbnNdIENvbnRleHQgY29waWVkIHRvIGNsaXBib2FyZFwiKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICAvLyByZW5kZXIgY29weSBidXR0b25cbiAgICBjb25zdCBjb3B5X2J1dHRvbiA9IHRoaXMuYWN0aXZlX2VsbS5jcmVhdGVFbChcInNwYW5cIiwge1xuICAgICAgY2xzOiBcInNjLW1zZy1idXR0b25cIixcbiAgICAgIGF0dHI6IHtcbiAgICAgICAgdGl0bGU6IFwiQ29weSBtZXNzYWdlIHRvIGNsaXBib2FyZFwiIC8qIHRvb2x0aXAgKi9cbiAgICAgIH1cbiAgICB9KTtcbiAgICBPYnNpZGlhbi5zZXRJY29uKGNvcHlfYnV0dG9uLCBcImNvcHlcIik7XG4gICAgY29weV9idXR0b24uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgIC8vIGNvcHkgbWVzc2FnZSB0byBjbGlwYm9hcmRcbiAgICAgIG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KG1lc3NhZ2UudHJpbUxlZnQoKSk7XG4gICAgICBuZXcgT2JzaWRpYW4uTm90aWNlKFwiW1NtYXJ0IENvbm5lY3Rpb25zXSBNZXNzYWdlIGNvcGllZCB0byBjbGlwYm9hcmRcIik7XG4gICAgfSk7XG4gIH1cblxuICBoYW5kbGVfbGlua3NfaW5fbWVzc2FnZSgpIHtcbiAgICBjb25zdCBsaW5rcyA9IHRoaXMuYWN0aXZlX2VsbS5xdWVyeVNlbGVjdG9yQWxsKFwiYVwiKTtcbiAgICAvLyBpZiB0aGlzIGFjdGl2ZSBlbGVtZW50IGNvbnRhaW5zIGEgbGlua1xuICAgIGlmIChsaW5rcy5sZW5ndGggPiAwKSB7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGxpbmtzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGNvbnN0IGxpbmsgPSBsaW5rc1tpXTtcbiAgICAgICAgY29uc3QgbGlua190ZXh0ID0gbGluay5nZXRBdHRyaWJ1dGUoXCJkYXRhLWhyZWZcIik7XG4gICAgICAgIC8vIHRyaWdnZXIgaG92ZXIgZXZlbnQgb24gbGlua1xuICAgICAgICBsaW5rLmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZW92ZXJcIiwgKGV2ZW50KSA9PiB7XG4gICAgICAgICAgdGhpcy5hcHAud29ya3NwYWNlLnRyaWdnZXIoXCJob3Zlci1saW5rXCIsIHtcbiAgICAgICAgICAgIGV2ZW50LFxuICAgICAgICAgICAgc291cmNlOiBTTUFSVF9DT05ORUNUSU9OU19DSEFUX1ZJRVdfVFlQRSxcbiAgICAgICAgICAgIGhvdmVyUGFyZW50OiBsaW5rLnBhcmVudEVsZW1lbnQsXG4gICAgICAgICAgICB0YXJnZXRFbDogbGluayxcbiAgICAgICAgICAgIC8vIGV4dHJhY3QgbGluayB0ZXh0IGZyb20gYS5kYXRhLWhyZWZcbiAgICAgICAgICAgIGxpbmt0ZXh0OiBsaW5rX3RleHRcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgIC8vIHRyaWdnZXIgb3BlbiBsaW5rIGV2ZW50IG9uIGxpbmtcbiAgICAgICAgbGluay5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiB7XG4gICAgICAgICAgY29uc3QgbGlua190ZmlsZSA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0Rmlyc3RMaW5rcGF0aERlc3QobGlua190ZXh0LCBcIi9cIik7XG4gICAgICAgICAgLy8gcHJvcGVybHkgaGFuZGxlIGlmIHRoZSBtZXRhL2N0cmwga2V5IGlzIHByZXNzZWRcbiAgICAgICAgICBjb25zdCBtb2QgPSBPYnNpZGlhbi5LZXltYXAuaXNNb2RFdmVudChldmVudCk7XG4gICAgICAgICAgLy8gZ2V0IG1vc3QgcmVjZW50IGxlYWZcbiAgICAgICAgICBsZXQgbGVhZiA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRMZWFmKG1vZCk7XG4gICAgICAgICAgbGVhZi5vcGVuRmlsZShsaW5rX3RmaWxlKTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgbmV3X21lc3NzYWdlX2J1YmJsZShmcm9tKSB7XG4gICAgbGV0IG1lc3NhZ2VfZWwgPSB0aGlzLm1lc3NhZ2VfY29udGFpbmVyLmNyZWF0ZURpdihgc2MtbWVzc2FnZSAke2Zyb219YCk7XG4gICAgLy8gY3JlYXRlIG1lc3NhZ2UgY29udGVudFxuICAgIHRoaXMuYWN0aXZlX2VsbSA9IG1lc3NhZ2VfZWwuY3JlYXRlRGl2KFwic2MtbWVzc2FnZS1jb250ZW50XCIpO1xuICAgIC8vIHNldCBsYXN0IGZyb21cbiAgICB0aGlzLmxhc3RfZnJvbSA9IGZyb207XG4gIH1cblxuICBhc3luYyByZXF1ZXN0X2NoYXRncHRfY29tcGxldGlvbihvcHRzPXt9KSB7XG4gICAgY29uc3QgY2hhdF9tbCA9IG9wdHMubWVzc2FnZXMgfHwgb3B0cy5jaGF0X21sIHx8IHRoaXMuY2hhdC5wcmVwYXJlX2NoYXRfbWwoKTtcbiAgICBjb25zb2xlLmxvZyhcImNoYXRfbWxcIiwgY2hhdF9tbCk7XG4gICAgY29uc3QgbWF4X3RvdGFsX3Rva2VucyA9IE1hdGgucm91bmQoZ2V0X21heF9jaGFycyh0aGlzLnBsdWdpbi5zZXR0aW5ncy5zbWFydF9jaGF0X21vZGVsKSAvIDQpO1xuICAgIGNvbnNvbGUubG9nKFwibWF4X3RvdGFsX3Rva2Vuc1wiLCBtYXhfdG90YWxfdG9rZW5zKTtcbiAgICBjb25zdCBjdXJyX3Rva2VuX2VzdCA9IE1hdGgucm91bmQoSlNPTi5zdHJpbmdpZnkoY2hhdF9tbCkubGVuZ3RoIC8gMyk7XG4gICAgY29uc29sZS5sb2coXCJjdXJyX3Rva2VuX2VzdFwiLCBjdXJyX3Rva2VuX2VzdCk7XG4gICAgbGV0IG1heF9hdmFpbGFibGVfdG9rZW5zID0gbWF4X3RvdGFsX3Rva2VucyAtIGN1cnJfdG9rZW5fZXN0O1xuICAgIC8vIGlmIG1heF9hdmFpbGFibGVfdG9rZW5zIGlzIGxlc3MgdGhhbiAwLCBzZXQgdG8gMjAwXG4gICAgaWYobWF4X2F2YWlsYWJsZV90b2tlbnMgPCAwKSBtYXhfYXZhaWxhYmxlX3Rva2VucyA9IDIwMDtcbiAgICBlbHNlIGlmKG1heF9hdmFpbGFibGVfdG9rZW5zID4gNDA5NikgbWF4X2F2YWlsYWJsZV90b2tlbnMgPSA0MDk2O1xuICAgIGNvbnNvbGUubG9nKFwibWF4X2F2YWlsYWJsZV90b2tlbnNcIiwgbWF4X2F2YWlsYWJsZV90b2tlbnMpO1xuICAgIG9wdHMgPSB7XG4gICAgICBtb2RlbDogdGhpcy5wbHVnaW4uc2V0dGluZ3Muc21hcnRfY2hhdF9tb2RlbCxcbiAgICAgIG1lc3NhZ2VzOiBjaGF0X21sLFxuICAgICAgLy8gbWF4X3Rva2VuczogMjUwLFxuICAgICAgbWF4X3Rva2VuczogbWF4X2F2YWlsYWJsZV90b2tlbnMsXG4gICAgICB0ZW1wZXJhdHVyZTogMC4zLFxuICAgICAgdG9wX3A6IDEsXG4gICAgICBwcmVzZW5jZV9wZW5hbHR5OiAwLFxuICAgICAgZnJlcXVlbmN5X3BlbmFsdHk6IDAsXG4gICAgICBzdHJlYW06IHRydWUsXG4gICAgICBzdG9wOiBudWxsLFxuICAgICAgbjogMSxcbiAgICAgIC8vIGxvZ2l0X2JpYXM6IGxvZ2l0X2JpYXMsXG4gICAgICAuLi5vcHRzXG4gICAgfVxuICAgIC8vIGNvbnNvbGUubG9nKG9wdHMubWVzc2FnZXMpO1xuICAgIGlmKG9wdHMuc3RyZWFtKSB7XG4gICAgICBjb25zdCBmdWxsX3N0ciA9IGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAvLyBjb25zb2xlLmxvZyhcInN0cmVhbVwiLCBvcHRzKTtcbiAgICAgICAgICBjb25zdCB1cmwgPSBgJHt0aGlzLnNldHRpbmdzLmFwaV9lbmRwb2ludH0vdjEvY2hhdC9jb21wbGV0aW9uc2A7XG4gICAgICAgICAgdGhpcy5hY3RpdmVfc3RyZWFtID0gbmV3IFNjU3RyZWFtZXIodXJsLCB7XG4gICAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgICAgICAgICBBdXRob3JpemF0aW9uOiBgQmVhcmVyICR7dGhpcy5wbHVnaW4uc2V0dGluZ3MuYXBpX2tleX1gXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgbWV0aG9kOiBcIlBPU1RcIixcbiAgICAgICAgICAgIHBheWxvYWQ6IEpTT04uc3RyaW5naWZ5KG9wdHMpXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgbGV0IHR4dCA9IFwiXCI7XG4gICAgICAgICAgdGhpcy5hY3RpdmVfc3RyZWFtLmFkZEV2ZW50TGlzdGVuZXIoXCJtZXNzYWdlXCIsIChlKSA9PiB7XG4gICAgICAgICAgICBpZiAoZS5kYXRhICE9IFwiW0RPTkVdXCIpIHtcbiAgICAgICAgICAgICAgY29uc3QgcGF5bG9hZCA9IEpTT04ucGFyc2UoZS5kYXRhKTtcbiAgICAgICAgICAgICAgY29uc3QgdGV4dCA9IHBheWxvYWQuY2hvaWNlc1swXS5kZWx0YS5jb250ZW50O1xuICAgICAgICAgICAgICBpZiAoIXRleHQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgdHh0ICs9IHRleHQ7XG4gICAgICAgICAgICAgIHRoaXMucmVuZGVyX21lc3NhZ2UodGV4dCwgXCJhc3Npc3RhbnRcIiwgdHJ1ZSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICB0aGlzLmVuZF9zdHJlYW0oKTtcbiAgICAgICAgICAgICAgcmVzb2x2ZSh0eHQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICAgIHRoaXMuYWN0aXZlX3N0cmVhbS5hZGRFdmVudExpc3RlbmVyKFwicmVhZHlzdGF0ZWNoYW5nZVwiLCAoZSkgPT4ge1xuICAgICAgICAgICAgaWYgKGUucmVhZHlTdGF0ZSA+PSAyKSB7XG4gICAgICAgICAgICAgIGNvbnNvbGUubG9nKFwiUmVhZHlTdGF0ZTogXCIgKyBlLnJlYWR5U3RhdGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICAgIHRoaXMuYWN0aXZlX3N0cmVhbS5hZGRFdmVudExpc3RlbmVyKFwiZXJyb3JcIiwgKGUpID0+IHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoZSk7XG4gICAgICAgICAgICBuZXcgT2JzaWRpYW4uTm90aWNlKFwiU21hcnQgQ29ubmVjdGlvbnMgRXJyb3IgU3RyZWFtaW5nIFJlc3BvbnNlLiBTZWUgY29uc29sZSBmb3IgZGV0YWlscy5cIik7XG4gICAgICAgICAgICB0aGlzLnJlbmRlcl9tZXNzYWdlKFwiKkFQSSBFcnJvci4gU2VlIGNvbnNvbGUgbG9ncyBmb3IgZGV0YWlscy4qXCIsIFwiYXNzaXN0YW50XCIpO1xuICAgICAgICAgICAgdGhpcy5lbmRfc3RyZWFtKCk7XG4gICAgICAgICAgICByZWplY3QoZSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgdGhpcy5hY3RpdmVfc3RyZWFtLnN0cmVhbSgpO1xuICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICBjb25zb2xlLmVycm9yKGVycik7XG4gICAgICAgICAgbmV3IE9ic2lkaWFuLk5vdGljZShcIlNtYXJ0IENvbm5lY3Rpb25zIEVycm9yIFN0cmVhbWluZyBSZXNwb25zZS4gU2VlIGNvbnNvbGUgZm9yIGRldGFpbHMuXCIpO1xuICAgICAgICAgIHRoaXMuZW5kX3N0cmVhbSgpO1xuICAgICAgICAgIHJlamVjdChlcnIpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIC8vIGNvbnNvbGUubG9nKGZ1bGxfc3RyKTtcbiAgICAgIGF3YWl0IHRoaXMucmVuZGVyX21lc3NhZ2UoZnVsbF9zdHIsIFwiYXNzaXN0YW50XCIpO1xuICAgICAgdGhpcy5jaGF0Lm5ld19tZXNzYWdlX2luX3RocmVhZCh7XG4gICAgICAgIHJvbGU6IFwiYXNzaXN0YW50XCIsXG4gICAgICAgIGNvbnRlbnQ6IGZ1bGxfc3RyXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9ZWxzZXtcbiAgICAgIHRyeXtcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCAoMCwgT2JzaWRpYW4ucmVxdWVzdFVybCkoe1xuICAgICAgICAgIHVybDogYCR7dGhpcy5zZXR0aW5ncy5hcGlfZW5kcG9pbnR9L3YxL2NoYXQvY29tcGxldGlvbnNgLFxuICAgICAgICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgQXV0aG9yaXphdGlvbjogYEJlYXJlciAke3RoaXMucGx1Z2luLnNldHRpbmdzLmFwaV9rZXl9YCxcbiAgICAgICAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiXG4gICAgICAgICAgfSxcbiAgICAgICAgICBjb250ZW50VHlwZTogXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkob3B0cyksXG4gICAgICAgICAgdGhyb3c6IGZhbHNlXG4gICAgICAgIH0pO1xuICAgICAgICAvLyBjb25zb2xlLmxvZyhyZXNwb25zZSk7XG4gICAgICAgIHJldHVybiBKU09OLnBhcnNlKHJlc3BvbnNlLnRleHQpLmNob2ljZXNbMF0ubWVzc2FnZS5jb250ZW50O1xuICAgICAgfWNhdGNoKGVycil7XG4gICAgICAgIG5ldyBPYnNpZGlhbi5Ob3RpY2UoYFNtYXJ0IENvbm5lY3Rpb25zIEFQSSBFcnJvciA6OiAke2Vycn1gKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBlbmRfc3RyZWFtKCkge1xuICAgIGlmKHRoaXMuYWN0aXZlX3N0cmVhbSl7XG4gICAgICB0aGlzLmFjdGl2ZV9zdHJlYW0uY2xvc2UoKTtcbiAgICAgIHRoaXMuYWN0aXZlX3N0cmVhbSA9IG51bGw7XG4gICAgfVxuICAgIHRoaXMudW5zZXRfc3RyZWFtaW5nX3V4KCk7XG4gICAgaWYodGhpcy5kb3Rkb3Rkb3RfaW50ZXJ2YWwpe1xuICAgICAgY2xlYXJJbnRlcnZhbCh0aGlzLmRvdGRvdGRvdF9pbnRlcnZhbCk7XG4gICAgICB0aGlzLmRvdGRvdGRvdF9pbnRlcnZhbCA9IG51bGw7XG4gICAgICAvLyByZW1vdmUgcGFyZW50IG9mIGFjdGl2ZV9lbG1cbiAgICAgIHRoaXMuYWN0aXZlX2VsbS5wYXJlbnRFbGVtZW50LnJlbW92ZSgpO1xuICAgICAgdGhpcy5hY3RpdmVfZWxtID0gbnVsbDtcbiAgICB9XG4gIH1cblxuICBhc3luYyBnZXRfY29udGV4dF9oeWRlKHVzZXJfaW5wdXQpIHtcbiAgICB0aGlzLmNoYXQucmVzZXRfY29udGV4dCgpO1xuICAgIC8vIGNvdW50IGN1cnJlbnQgY2hhdCBtbCBtZXNzYWdlcyB0byBkZXRlcm1pbmUgJ3F1ZXN0aW9uJyBvciAnY2hhdCBsb2cnIHdvcmRpbmdcbiAgICBjb25zdCBoeWRfaW5wdXQgPSBgQW50aWNpcGF0ZSB3aGF0IHRoZSB1c2VyIGlzIHNlZWtpbmcuIFJlc3BvbmQgaW4gdGhlIGZvcm0gb2YgYSBoeXBvdGhldGljYWwgbm90ZSB3cml0dGVuIGJ5IHRoZSB1c2VyLiBUaGUgbm90ZSBtYXkgY29udGFpbiBzdGF0ZW1lbnRzIGFzIHBhcmFncmFwaHMsIGxpc3RzLCBvciBjaGVja2xpc3RzIGluIG1hcmtkb3duIGZvcm1hdCB3aXRoIG5vIGhlYWRpbmdzLiBQbGVhc2UgcmVzcG9uZCB3aXRoIG9uZSBoeXBvdGhldGljYWwgbm90ZSBhbmQgYWJzdGFpbiBmcm9tIGFueSBvdGhlciBjb21tZW50YXJ5LiBVc2UgdGhlIGZvcm1hdDogUEFSRU5UIEZPTERFUiBOQU1FID4gQ0hJTEQgRk9MREVSIE5BTUUgPiBGSUxFIE5BTUUgPiBIRUFESU5HIDEgPiBIRUFESU5HIDIgPiBIRUFESU5HIDM6IEhZUE9USEVUSUNBTCBOT1RFIENPTlRFTlRTLmA7XG4gICAgLy8gY29tcGxldGVcbiAgICBjb25zdCBjaGF0bWwgPSBbXG4gICAgICB7XG4gICAgICAgIHJvbGU6IFwic3lzdGVtXCIsXG4gICAgICAgIGNvbnRlbnQ6IGh5ZF9pbnB1dCBcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIHJvbGU6IFwidXNlclwiLFxuICAgICAgICBjb250ZW50OiB1c2VyX2lucHV0XG4gICAgICB9XG4gICAgXTtcbiAgICBjb25zdCBoeWQgPSBhd2FpdCB0aGlzLnJlcXVlc3RfY2hhdGdwdF9jb21wbGV0aW9uKHtcbiAgICAgIG1lc3NhZ2VzOiBjaGF0bWwsXG4gICAgICBzdHJlYW06IGZhbHNlLFxuICAgICAgdGVtcGVyYXR1cmU6IDAsXG4gICAgICBtYXhfdG9rZW5zOiAxMzcsXG4gICAgfSk7XG4gICAgdGhpcy5jaGF0Lmh5ZCA9IGh5ZDtcbiAgICAvLyBjb25zb2xlLmxvZyhoeWQpO1xuICAgIGxldCBmaWx0ZXIgPSB7fTtcbiAgICAvLyBpZiBjb250YWlucyBmb2xkZXIgcmVmZXJlbmNlIHJlcHJlc2VudGVkIGJ5IC9mb2xkZXIvXG4gICAgaWYodGhpcy5jaGF0LmNvbnRhaW5zX2ZvbGRlcl9yZWZlcmVuY2UodXNlcl9pbnB1dCkpIHtcbiAgICAgIC8vIGdldCBmb2xkZXIgcmVmZXJlbmNlc1xuICAgICAgY29uc3QgZm9sZGVyX3JlZnMgPSB0aGlzLmNoYXQuZ2V0X2ZvbGRlcl9yZWZlcmVuY2VzKHVzZXJfaW5wdXQpO1xuICAgICAgLy8gY29uc29sZS5sb2coZm9sZGVyX3JlZnMpO1xuICAgICAgLy8gaWYgZm9sZGVyIHJlZmVyZW5jZXMgYXJlIHZhbGlkIChzdHJpbmcgb3IgYXJyYXkgb2Ygc3RyaW5ncylcbiAgICAgIGlmKGZvbGRlcl9yZWZzKXtcbiAgICAgICAgZmlsdGVyID0ge1xuICAgICAgICAgIHBhdGhfYmVnaW5zX3dpdGg6IGZvbGRlcl9yZWZzXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgfVxuICAgIC8vIHNlYXJjaCBmb3IgbmVhcmVzdCBiYXNlZCBvbiBoeWRcbiAgICBsZXQgbmVhcmVzdCA9IGF3YWl0IHRoaXMucGx1Z2luLmFwaS5zZWFyY2goaHlkLCBmaWx0ZXIpO1xuICAgIGNvbnNvbGUubG9nKFwibmVhcmVzdFwiLCBuZWFyZXN0Lmxlbmd0aCk7XG4gICAgbmVhcmVzdCA9IHRoaXMuZ2V0X25lYXJlc3RfdW50aWxfbmV4dF9kZXZfZXhjZWVkc19zdGRfZGV2KG5lYXJlc3QpO1xuICAgIGNvbnNvbGUubG9nKFwibmVhcmVzdCBhZnRlciBzdGQgZGV2IHNsaWNlXCIsIG5lYXJlc3QubGVuZ3RoKTtcbiAgICBuZWFyZXN0ID0gdGhpcy5zb3J0X2J5X2xlbl9hZGp1c3RlZF9zaW1pbGFyaXR5KG5lYXJlc3QpO1xuICAgIFxuICAgIHJldHVybiBhd2FpdCB0aGlzLmdldF9jb250ZXh0X2Zvcl9wcm9tcHQobmVhcmVzdCk7XG4gIH1cbiAgXG4gIFxuICBzb3J0X2J5X2xlbl9hZGp1c3RlZF9zaW1pbGFyaXR5KG5lYXJlc3QpIHtcbiAgICAvLyByZS1zb3J0IGJ5IHF1b3RpZW50IG9mIHNpbWlsYXJpdHkgZGl2aWRlZCBieSBsZW4gREVTQ1xuICAgIG5lYXJlc3QgPSBuZWFyZXN0LnNvcnQoKGEsIGIpID0+IHtcbiAgICAgIGNvbnN0IGFfc2NvcmUgPSBhLnNpbWlsYXJpdHkgLyBhLmxlbjtcbiAgICAgIGNvbnN0IGJfc2NvcmUgPSBiLnNpbWlsYXJpdHkgLyBiLmxlbjtcbiAgICAgIC8vIGlmIGEgaXMgZ3JlYXRlciB0aGFuIGIsIHJldHVybiAtMVxuICAgICAgaWYgKGFfc2NvcmUgPiBiX3Njb3JlKVxuICAgICAgICByZXR1cm4gLTE7XG4gICAgICAvLyBpZiBhIGlzIGxlc3MgdGhhbiBiLCByZXR1cm4gMVxuICAgICAgaWYgKGFfc2NvcmUgPCBiX3Njb3JlKVxuICAgICAgICByZXR1cm4gMTtcbiAgICAgIC8vIGlmIGEgaXMgZXF1YWwgdG8gYiwgcmV0dXJuIDBcbiAgICAgIHJldHVybiAwO1xuICAgIH0pO1xuICAgIHJldHVybiBuZWFyZXN0O1xuICB9XG5cbiAgZ2V0X25lYXJlc3RfdW50aWxfbmV4dF9kZXZfZXhjZWVkc19zdGRfZGV2KG5lYXJlc3QpIHtcbiAgICAvLyBnZXQgc3RkIGRldiBvZiBzaW1pbGFyaXR5XG4gICAgY29uc3Qgc2ltID0gbmVhcmVzdC5tYXAoKG4pID0+IG4uc2ltaWxhcml0eSk7XG4gICAgY29uc3QgbWVhbiA9IHNpbS5yZWR1Y2UoKGEsIGIpID0+IGEgKyBiKSAvIHNpbS5sZW5ndGg7XG4gICAgbGV0IHN0ZF9kZXYgPSBNYXRoLnNxcnQoc2ltLm1hcCgoeCkgPT4gTWF0aC5wb3coeCAtIG1lYW4sIDIpKS5yZWR1Y2UoKGEsIGIpID0+IGEgKyBiKSAvIHNpbS5sZW5ndGgpO1xuICAgIC8vIHNsaWNlIHdoZXJlIG5leHQgaXRlbSBkZXZpYXRpb24gaXMgZ3JlYXRlciB0aGFuIHN0ZF9kZXZcbiAgICBsZXQgc2xpY2VfaSA9IDA7XG4gICAgd2hpbGUgKHNsaWNlX2kgPCBuZWFyZXN0Lmxlbmd0aCkge1xuICAgICAgY29uc3QgbmV4dCA9IG5lYXJlc3Rbc2xpY2VfaSArIDFdO1xuICAgICAgaWYgKG5leHQpIHtcbiAgICAgICAgY29uc3QgbmV4dF9kZXYgPSBNYXRoLmFicyhuZXh0LnNpbWlsYXJpdHkgLSBuZWFyZXN0W3NsaWNlX2ldLnNpbWlsYXJpdHkpO1xuICAgICAgICBpZiAobmV4dF9kZXYgPiBzdGRfZGV2KSB7XG4gICAgICAgICAgaWYoc2xpY2VfaSA8IDMpIHN0ZF9kZXYgPSBzdGRfZGV2ICogMS41O1xuICAgICAgICAgIGVsc2UgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHNsaWNlX2krKztcbiAgICB9XG4gICAgLy8gc2VsZWN0IHRvcCByZXN1bHRzXG4gICAgbmVhcmVzdCA9IG5lYXJlc3Quc2xpY2UoMCwgc2xpY2VfaSsxKTtcbiAgICByZXR1cm4gbmVhcmVzdDtcbiAgfVxuICAvLyB0aGlzLnRlc3RfZ2V0X25lYXJlc3RfdW50aWxfbmV4dF9kZXZfZXhjZWVkc19zdGRfZGV2KCk7XG4gIC8vIC8vIHRlc3QgZ2V0X25lYXJlc3RfdW50aWxfbmV4dF9kZXZfZXhjZWVkc19zdGRfZGV2XG4gIC8vIHRlc3RfZ2V0X25lYXJlc3RfdW50aWxfbmV4dF9kZXZfZXhjZWVkc19zdGRfZGV2KCkge1xuICAvLyAgIGNvbnN0IG5lYXJlc3QgPSBbe3NpbWlsYXJpdHk6IDAuOTl9LCB7c2ltaWxhcml0eTogMC45OH0sIHtzaW1pbGFyaXR5OiAwLjk3fSwge3NpbWlsYXJpdHk6IDAuOTZ9LCB7c2ltaWxhcml0eTogMC45NX0sIHtzaW1pbGFyaXR5OiAwLjk0fSwge3NpbWlsYXJpdHk6IDAuOTN9LCB7c2ltaWxhcml0eTogMC45Mn0sIHtzaW1pbGFyaXR5OiAwLjkxfSwge3NpbWlsYXJpdHk6IDAuOX0sIHtzaW1pbGFyaXR5OiAwLjc5fSwge3NpbWlsYXJpdHk6IDAuNzh9LCB7c2ltaWxhcml0eTogMC43N30sIHtzaW1pbGFyaXR5OiAwLjc2fSwge3NpbWlsYXJpdHk6IDAuNzV9LCB7c2ltaWxhcml0eTogMC43NH0sIHtzaW1pbGFyaXR5OiAwLjczfSwge3NpbWlsYXJpdHk6IDAuNzJ9XTtcbiAgLy8gICBjb25zdCByZXN1bHQgPSB0aGlzLmdldF9uZWFyZXN0X3VudGlsX25leHRfZGV2X2V4Y2VlZHNfc3RkX2RldihuZWFyZXN0KTtcbiAgLy8gICBpZihyZXN1bHQubGVuZ3RoICE9PSAxMCl7XG4gIC8vICAgICBjb25zb2xlLmVycm9yKFwiZ2V0X25lYXJlc3RfdW50aWxfbmV4dF9kZXZfZXhjZWVkc19zdGRfZGV2IGZhaWxlZFwiLCByZXN1bHQpO1xuICAvLyAgIH1cbiAgLy8gfVxuXG4gIGFzeW5jIGdldF9jb250ZXh0X2Zvcl9wcm9tcHQobmVhcmVzdCkge1xuICAgIGxldCBjb250ZXh0ID0gW107XG4gICAgY29uc3QgTUFYX1NPVVJDRVMgPSAodGhpcy5wbHVnaW4uc2V0dGluZ3Muc21hcnRfY2hhdF9tb2RlbCA9PT0gJ2dwdC00LTExMDYtcHJldmlldycpID8gNDIgOiAyMDtcbiAgICBjb25zdCBNQVhfQ0hBUlMgPSBnZXRfbWF4X2NoYXJzKHRoaXMucGx1Z2luLnNldHRpbmdzLnNtYXJ0X2NoYXRfbW9kZWwpIC8gMjtcbiAgICBsZXQgY2hhcl9hY2N1bSA9IDA7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBuZWFyZXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoY29udGV4dC5sZW5ndGggPj0gTUFYX1NPVVJDRVMpXG4gICAgICAgIGJyZWFrO1xuICAgICAgaWYgKGNoYXJfYWNjdW0gPj0gTUFYX0NIQVJTKVxuICAgICAgICBicmVhaztcbiAgICAgIGlmICh0eXBlb2YgbmVhcmVzdFtpXS5saW5rICE9PSAnc3RyaW5nJylcbiAgICAgICAgY29udGludWU7XG4gICAgICAvLyBnZW5lcmF0ZSBicmVhZGNydW1ic1xuICAgICAgY29uc3QgYnJlYWRjcnVtYnMgPSBuZWFyZXN0W2ldLmxpbmsucmVwbGFjZSgvIy9nLCBcIiA+IFwiKS5yZXBsYWNlKFwiLm1kXCIsIFwiXCIpLnJlcGxhY2UoL1xcLy9nLCBcIiA+IFwiKTtcbiAgICAgIGxldCBuZXdfY29udGV4dCA9IGAke2JyZWFkY3J1bWJzfTpcXG5gO1xuICAgICAgLy8gZ2V0IG1heCBhdmFpbGFibGUgY2hhcnMgdG8gYWRkIHRvIGNvbnRleHRcbiAgICAgIGNvbnN0IG1heF9hdmFpbGFibGVfY2hhcnMgPSBNQVhfQ0hBUlMgLSBjaGFyX2FjY3VtIC0gbmV3X2NvbnRleHQubGVuZ3RoO1xuICAgICAgaWYgKG5lYXJlc3RbaV0ubGluay5pbmRleE9mKFwiI1wiKSAhPT0gLTEpIHsgLy8gaXMgYmxvY2tcbiAgICAgICAgbmV3X2NvbnRleHQgKz0gYXdhaXQgdGhpcy5wbHVnaW4uYmxvY2tfcmV0cmlldmVyKG5lYXJlc3RbaV0ubGluaywgeyBtYXhfY2hhcnM6IG1heF9hdmFpbGFibGVfY2hhcnMgfSk7XG4gICAgICB9IGVsc2UgeyAvLyBpcyBmaWxlXG4gICAgICAgIG5ld19jb250ZXh0ICs9IGF3YWl0IHRoaXMucGx1Z2luLmZpbGVfcmV0cmlldmVyKG5lYXJlc3RbaV0ubGluaywgeyBtYXhfY2hhcnM6IG1heF9hdmFpbGFibGVfY2hhcnMgfSk7XG4gICAgICB9XG4gICAgICAvLyBhZGQgdG8gY2hhcl9hY2N1bVxuICAgICAgY2hhcl9hY2N1bSArPSBuZXdfY29udGV4dC5sZW5ndGg7XG4gICAgICAvLyBhZGQgdG8gY29udGV4dFxuICAgICAgY29udGV4dC5wdXNoKHtcbiAgICAgICAgbGluazogbmVhcmVzdFtpXS5saW5rLFxuICAgICAgICB0ZXh0OiBuZXdfY29udGV4dFxuICAgICAgfSk7XG4gICAgfVxuICAgIC8vIGNvbnRleHQgc291cmNlc1xuICAgIGNvbnNvbGUubG9nKFwiY29udGV4dCBzb3VyY2VzOiBcIiArIGNvbnRleHQubGVuZ3RoKTtcbiAgICAvLyBjaGFyX2FjY3VtIGRpdmlkZWQgYnkgNCBhbmQgcm91bmRlZCB0byBuZWFyZXN0IGludGVnZXIgZm9yIGVzdGltYXRlZCB0b2tlbnNcbiAgICBjb25zb2xlLmxvZyhcInRvdGFsIGNvbnRleHQgdG9rZW5zOiB+XCIgKyBNYXRoLnJvdW5kKGNoYXJfYWNjdW0gLyAzLjUpKTtcbiAgICAvLyBidWlsZCBjb250ZXh0IGlucHV0XG4gICAgdGhpcy5jaGF0LmNvbnRleHQgPSBgQW50aWNpcGF0ZSB0aGUgdHlwZSBvZiBhbnN3ZXIgZGVzaXJlZCBieSB0aGUgdXNlci4gSW1hZ2luZSB0aGUgZm9sbG93aW5nICR7Y29udGV4dC5sZW5ndGh9IG5vdGVzIHdlcmUgd3JpdHRlbiBieSB0aGUgdXNlciBhbmQgY29udGFpbiBhbGwgdGhlIG5lY2Vzc2FyeSBpbmZvcm1hdGlvbiB0byBhbnN3ZXIgdGhlIHVzZXIncyBxdWVzdGlvbi4gQmVnaW4gcmVzcG9uc2VzIHdpdGggXCIke1NNQVJUX1RSQU5TTEFUSU9OW3RoaXMucGx1Z2luLnNldHRpbmdzLmxhbmd1YWdlXS5wcm9tcHR9Li4uXCJgO1xuICAgIGZvcihsZXQgaSA9IDA7IGkgPCBjb250ZXh0Lmxlbmd0aDsgaSsrKSB7XG4gICAgICB0aGlzLmNoYXQuY29udGV4dCArPSBgXFxuLS0tQkVHSU4gIyR7aSsxfS0tLVxcbiR7Y29udGV4dFtpXS50ZXh0fVxcbi0tLUVORCAjJHtpKzF9LS0tYDtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuY2hhdC5jb250ZXh0O1xuICB9XG5cblxufVxuXG5mdW5jdGlvbiBnZXRfbWF4X2NoYXJzKG1vZGVsPVwiZ3B0LTMuNS10dXJib1wiKSB7XG4gIGNvbnN0IE1BWF9DSEFSX01BUCA9IHtcbiAgICBcImdwdC0zLjUtdHVyYm8tMTZrXCI6IDQ4MDAwLFxuICAgIFwiZ3B0LTRcIjogMjQwMDAsXG4gICAgXCJncHQtMy41LXR1cmJvXCI6IDEyMDAwLFxuICAgIFwiZ3B0LTQtMTEwNi1wcmV2aWV3XCI6IDIwMDAwMCxcbiAgfTtcbiAgcmV0dXJuIE1BWF9DSEFSX01BUFttb2RlbF07XG59XG4vKipcbiAqIFNtYXJ0Q29ubmVjdGlvbnNDaGF0TW9kZWxcbiAqIC0tLVxuICogLSAndGhyZWFkJyBmb3JtYXQ6IEFycmF5W0FycmF5W09iamVjdHtyb2xlLCBjb250ZW50LCBoeWRlfV1dXG4gKiAgLSBbVHVyblt2YXJpYXRpb257fV0sIFR1cm5bdmFyaWF0aW9ue30sIHZhcmlhdGlvbnt9XSwgLi4uXVxuICogLSBTYXZlcyBpbiAndGhyZWFkJyBmb3JtYXQgdG8gSlNPTiBmaWxlIGluIC5zbWFydC1jb25uZWN0aW9ucyBmb2xkZXIgdXNpbmcgY2hhdF9pZCBhcyBmaWxlbmFtZVxuICogLSBMb2FkcyBjaGF0IGluICd0aHJlYWQnIGZvcm1hdCBBcnJheVtBcnJheVtPYmplY3R7cm9sZSwgY29udGVudCwgaHlkZX1dXSBmcm9tIEpTT04gZmlsZSBpbiAuc21hcnQtY29ubmVjdGlvbnMgZm9sZGVyXG4gKiAtIHByZXBhcmVzIGNoYXRfbWwgcmV0dXJucyBpbiAnQ2hhdE1MJyBmb3JtYXQgXG4gKiAgLSBzdHJpcHMgYWxsIGJ1dCByb2xlIGFuZCBjb250ZW50IHByb3BlcnRpZXMgZnJvbSBPYmplY3QgaW4gQ2hhdE1MIGZvcm1hdFxuICogLSBDaGF0TUwgQXJyYXlbT2JqZWN0e3JvbGUsIGNvbnRlbnR9XVxuICogIC0gW0N1cnJlbnRfVmFyaWF0aW9uX0Zvcl9UdXJuXzF7fSwgQ3VycmVudF9WYXJpYXRpb25fRm9yX1R1cm5fMnt9LCAuLi5dXG4gKi9cbmNsYXNzIFNtYXJ0Q29ubmVjdGlvbnNDaGF0TW9kZWwge1xuICBjb25zdHJ1Y3RvcihwbHVnaW4pIHtcbiAgICB0aGlzLmFwcCA9IHBsdWdpbi5hcHA7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gICAgdGhpcy5jaGF0X2lkID0gbnVsbDtcbiAgICB0aGlzLmNoYXRfbWwgPSBbXTtcbiAgICB0aGlzLmNvbnRleHQgPSBudWxsO1xuICAgIHRoaXMuaHlkID0gbnVsbDtcbiAgICB0aGlzLnRocmVhZCA9IFtdO1xuICB9XG4gIGFzeW5jIHNhdmVfY2hhdCgpIHtcbiAgICAvLyByZXR1cm4gaWYgdGhyZWFkIGlzIGVtcHR5XG4gICAgaWYgKHRoaXMudGhyZWFkLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICAgIC8vIHNhdmUgY2hhdCB0byBmaWxlIGluIC5zbWFydC1jb25uZWN0aW9ucyBmb2xkZXJcbiAgICAvLyBjcmVhdGUgLnNtYXJ0LWNvbm5lY3Rpb25zL2NoYXRzLyBmb2xkZXIgaWYgaXQgZG9lc24ndCBleGlzdFxuICAgIGlmICghKGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIuZXhpc3RzKFwiLnNtYXJ0LWNvbm5lY3Rpb25zL2NoYXRzXCIpKSkge1xuICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci5ta2RpcihcIi5zbWFydC1jb25uZWN0aW9ucy9jaGF0c1wiKTtcbiAgICB9XG4gICAgLy8gaWYgY2hhdF9pZCBpcyBub3Qgc2V0LCBzZXQgaXQgdG8gVU5USVRMRUQtJHt1bml4IHRpbWVzdGFtcH1cbiAgICBpZiAoIXRoaXMuY2hhdF9pZCkge1xuICAgICAgdGhpcy5jaGF0X2lkID0gdGhpcy5uYW1lKCkgKyBcIlx1MjAxNFwiICsgdGhpcy5nZXRfZmlsZV9kYXRlX3N0cmluZygpO1xuICAgIH1cbiAgICAvLyB2YWxpZGF0ZSBjaGF0X2lkIGlzIHNldCB0byB2YWxpZCBmaWxlbmFtZSBjaGFyYWN0ZXJzIChsZXR0ZXJzLCBudW1iZXJzLCB1bmRlcnNjb3JlcywgZGFzaGVzLCBlbSBkYXNoLCBhbmQgc3BhY2VzKVxuICAgIGlmICghdGhpcy5jaGF0X2lkLm1hdGNoKC9eW2EtekEtWjAtOV9cdTIwMTRcXC0gXSskLykpIHtcbiAgICAgIGNvbnNvbGUubG9nKFwiSW52YWxpZCBjaGF0X2lkOiBcIiArIHRoaXMuY2hhdF9pZCk7XG4gICAgICBuZXcgT2JzaWRpYW4uTm90aWNlKFwiW1NtYXJ0IENvbm5lY3Rpb25zXSBGYWlsZWQgdG8gc2F2ZSBjaGF0LiBJbnZhbGlkIGNoYXRfaWQ6ICdcIiArIHRoaXMuY2hhdF9pZCArIFwiJ1wiKTtcbiAgICB9XG4gICAgLy8gZmlsZW5hbWUgaXMgY2hhdF9pZFxuICAgIGNvbnN0IGNoYXRfZmlsZSA9IHRoaXMuY2hhdF9pZCArIFwiLmpzb25cIjtcbiAgICB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLndyaXRlKFxuICAgICAgXCIuc21hcnQtY29ubmVjdGlvbnMvY2hhdHMvXCIgKyBjaGF0X2ZpbGUsXG4gICAgICBKU09OLnN0cmluZ2lmeSh0aGlzLnRocmVhZCwgbnVsbCwgMilcbiAgICApO1xuICB9XG4gIGFzeW5jIGxvYWRfY2hhdChjaGF0X2lkKSB7XG4gICAgdGhpcy5jaGF0X2lkID0gY2hhdF9pZDtcbiAgICAvLyBsb2FkIGNoYXQgZnJvbSBmaWxlIGluIC5zbWFydC1jb25uZWN0aW9ucyBmb2xkZXJcbiAgICAvLyBmaWxlbmFtZSBpcyBjaGF0X2lkXG4gICAgY29uc3QgY2hhdF9maWxlID0gdGhpcy5jaGF0X2lkICsgXCIuanNvblwiO1xuICAgIC8vIHJlYWQgZmlsZVxuICAgIGxldCBjaGF0X2pzb24gPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLnJlYWQoXG4gICAgICBcIi5zbWFydC1jb25uZWN0aW9ucy9jaGF0cy9cIiArIGNoYXRfZmlsZVxuICAgICk7XG4gICAgLy8gcGFyc2UganNvblxuICAgIHRoaXMudGhyZWFkID0gSlNPTi5wYXJzZShjaGF0X2pzb24pO1xuICAgIC8vIGxvYWQgY2hhdF9tbFxuICAgIHRoaXMuY2hhdF9tbCA9IHRoaXMucHJlcGFyZV9jaGF0X21sKCk7XG4gICAgLy8gcmVuZGVyIG1lc3NhZ2VzIGluIGNoYXQgdmlld1xuICAgIC8vIGZvciBlYWNoIHR1cm4gaW4gY2hhdF9tbFxuICAgIC8vIGNvbnNvbGUubG9nKHRoaXMudGhyZWFkKTtcbiAgICAvLyBjb25zb2xlLmxvZyh0aGlzLmNoYXRfbWwpO1xuICB9XG4gIC8vIHByZXBhcmUgY2hhdF9tbCBmcm9tIGNoYXRcbiAgLy8gZ2V0cyB0aGUgbGFzdCBtZXNzYWdlIG9mIGVhY2ggdHVybiB1bmxlc3MgdHVybl92YXJpYXRpb25fb2Zmc2V0cz1bW3R1cm5faW5kZXgsdmFyaWF0aW9uX2luZGV4XV0gaXMgc3BlY2lmaWVkIGluIG9mZnNldFxuICBwcmVwYXJlX2NoYXRfbWwodHVybl92YXJpYXRpb25fb2Zmc2V0cz1bXSkge1xuICAgIC8vIGlmIG5vIHR1cm5fdmFyaWF0aW9uX29mZnNldHMsIGdldCB0aGUgbGFzdCBtZXNzYWdlIG9mIGVhY2ggdHVyblxuICAgIGlmKHR1cm5fdmFyaWF0aW9uX29mZnNldHMubGVuZ3RoID09PSAwKXtcbiAgICAgIHRoaXMuY2hhdF9tbCA9IHRoaXMudGhyZWFkLm1hcCh0dXJuID0+IHtcbiAgICAgICAgcmV0dXJuIHR1cm5bdHVybi5sZW5ndGggLSAxXTtcbiAgICAgIH0pO1xuICAgIH1lbHNle1xuICAgICAgLy8gY3JlYXRlIGFuIGFycmF5IGZyb20gdHVybl92YXJpYXRpb25fb2Zmc2V0cyB0aGF0IGluZGV4ZXMgdmFyaWF0aW9uX2luZGV4IGF0IHR1cm5faW5kZXhcbiAgICAgIC8vIGV4LiBbWzMsNV1dID0+IFt1bmRlZmluZWQsIHVuZGVmaW5lZCwgdW5kZWZpbmVkLCA1XVxuICAgICAgbGV0IHR1cm5fdmFyaWF0aW9uX2luZGV4ID0gW107XG4gICAgICBmb3IobGV0IGkgPSAwOyBpIDwgdHVybl92YXJpYXRpb25fb2Zmc2V0cy5sZW5ndGg7IGkrKyl7XG4gICAgICAgIHR1cm5fdmFyaWF0aW9uX2luZGV4W3R1cm5fdmFyaWF0aW9uX29mZnNldHNbaV1bMF1dID0gdHVybl92YXJpYXRpb25fb2Zmc2V0c1tpXVsxXTtcbiAgICAgIH1cbiAgICAgIC8vIGxvb3AgdGhyb3VnaCBjaGF0XG4gICAgICB0aGlzLmNoYXRfbWwgPSB0aGlzLnRocmVhZC5tYXAoKHR1cm4sIHR1cm5faW5kZXgpID0+IHtcbiAgICAgICAgLy8gaWYgdGhlcmUgaXMgYW4gaW5kZXggZm9yIHRoaXMgdHVybiwgcmV0dXJuIHRoZSB2YXJpYXRpb24gYXQgdGhhdCBpbmRleFxuICAgICAgICBpZih0dXJuX3ZhcmlhdGlvbl9pbmRleFt0dXJuX2luZGV4XSAhPT0gdW5kZWZpbmVkKXtcbiAgICAgICAgICByZXR1cm4gdHVyblt0dXJuX3ZhcmlhdGlvbl9pbmRleFt0dXJuX2luZGV4XV07XG4gICAgICAgIH1cbiAgICAgICAgLy8gb3RoZXJ3aXNlIHJldHVybiB0aGUgbGFzdCBtZXNzYWdlIG9mIHRoZSB0dXJuXG4gICAgICAgIHJldHVybiB0dXJuW3R1cm4ubGVuZ3RoIC0gMV07XG4gICAgICB9KTtcbiAgICB9XG4gICAgLy8gc3RyaXAgYWxsIGJ1dCByb2xlIGFuZCBjb250ZW50IHByb3BlcnRpZXMgZnJvbSBlYWNoIG1lc3NhZ2VcbiAgICB0aGlzLmNoYXRfbWwgPSB0aGlzLmNoYXRfbWwubWFwKG1lc3NhZ2UgPT4ge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgcm9sZTogbWVzc2FnZS5yb2xlLFxuICAgICAgICBjb250ZW50OiBtZXNzYWdlLmNvbnRlbnRcbiAgICAgIH07XG4gICAgfSk7XG4gICAgcmV0dXJuIHRoaXMuY2hhdF9tbDtcbiAgfVxuICBsYXN0KCkge1xuICAgIC8vIGdldCBsYXN0IG1lc3NhZ2UgZnJvbSBjaGF0XG4gICAgcmV0dXJuIHRoaXMudGhyZWFkW3RoaXMudGhyZWFkLmxlbmd0aCAtIDFdW3RoaXMudGhyZWFkW3RoaXMudGhyZWFkLmxlbmd0aCAtIDFdLmxlbmd0aCAtIDFdO1xuICB9XG4gIGxhc3RfZnJvbSgpIHtcbiAgICByZXR1cm4gdGhpcy5sYXN0KCkucm9sZTtcbiAgfVxuICAvLyByZXR1cm5zIHVzZXJfaW5wdXQgb3IgY29tcGxldGlvblxuICBsYXN0X21lc3NhZ2UoKSB7XG4gICAgcmV0dXJuIHRoaXMubGFzdCgpLmNvbnRlbnQ7XG4gIH1cbiAgLy8gbWVzc2FnZT17fVxuICAvLyBhZGQgbmV3IG1lc3NhZ2UgdG8gdGhyZWFkXG4gIG5ld19tZXNzYWdlX2luX3RocmVhZChtZXNzYWdlLCB0dXJuPS0xKSB7XG4gICAgLy8gaWYgdHVybiBpcyAtMSwgYWRkIHRvIG5ldyB0dXJuXG4gICAgaWYodGhpcy5jb250ZXh0KXtcbiAgICAgIG1lc3NhZ2UuY29udGV4dCA9IHRoaXMuY29udGV4dDtcbiAgICAgIHRoaXMuY29udGV4dCA9IG51bGw7XG4gICAgfVxuICAgIGlmKHRoaXMuaHlkKXtcbiAgICAgIG1lc3NhZ2UuaHlkID0gdGhpcy5oeWQ7XG4gICAgICB0aGlzLmh5ZCA9IG51bGw7XG4gICAgfVxuICAgIGlmICh0dXJuID09PSAtMSkge1xuICAgICAgdGhpcy50aHJlYWQucHVzaChbbWVzc2FnZV0pO1xuICAgIH1lbHNle1xuICAgICAgLy8gb3RoZXJ3aXNlIGFkZCB0byBzcGVjaWZpZWQgdHVyblxuICAgICAgdGhpcy50aHJlYWRbdHVybl0ucHVzaChtZXNzYWdlKTtcbiAgICB9XG4gIH1cbiAgcmVzZXRfY29udGV4dCgpe1xuICAgIHRoaXMuY29udGV4dCA9IG51bGw7XG4gICAgdGhpcy5oeWQgPSBudWxsO1xuICB9XG4gIGFzeW5jIHJlbmFtZV9jaGF0KG5ld19uYW1lKXtcbiAgICAvLyBjaGVjayBpZiBjdXJyZW50IGNoYXRfaWQgZmlsZSBleGlzdHNcbiAgICBpZiAodGhpcy5jaGF0X2lkICYmIGF3YWl0IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIuZXhpc3RzKFwiLnNtYXJ0LWNvbm5lY3Rpb25zL2NoYXRzL1wiICsgdGhpcy5jaGF0X2lkICsgXCIuanNvblwiKSkge1xuICAgICAgbmV3X25hbWUgPSB0aGlzLmNoYXRfaWQucmVwbGFjZSh0aGlzLm5hbWUoKSwgbmV3X25hbWUpO1xuICAgICAgLy8gcmVuYW1lIGZpbGUgaWYgaXQgZXhpc3RzXG4gICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLnJlbmFtZShcbiAgICAgICAgXCIuc21hcnQtY29ubmVjdGlvbnMvY2hhdHMvXCIgKyB0aGlzLmNoYXRfaWQgKyBcIi5qc29uXCIsXG4gICAgICAgIFwiLnNtYXJ0LWNvbm5lY3Rpb25zL2NoYXRzL1wiICsgbmV3X25hbWUgKyBcIi5qc29uXCJcbiAgICAgICk7XG4gICAgICAvLyBzZXQgY2hhdF9pZCB0byBuZXdfbmFtZVxuICAgICAgdGhpcy5jaGF0X2lkID0gbmV3X25hbWU7XG4gICAgfWVsc2V7XG4gICAgICB0aGlzLmNoYXRfaWQgPSBuZXdfbmFtZSArIFwiXHUyMDE0XCIgKyB0aGlzLmdldF9maWxlX2RhdGVfc3RyaW5nKCk7XG4gICAgICAvLyBzYXZlIGNoYXRcbiAgICAgIGF3YWl0IHRoaXMuc2F2ZV9jaGF0KCk7XG4gICAgfVxuXG4gIH1cblxuICBuYW1lKCkge1xuICAgIGlmKHRoaXMuY2hhdF9pZCl7XG4gICAgICAvLyByZW1vdmUgZGF0ZSBhZnRlciBsYXN0IGVtIGRhc2hcbiAgICAgIHJldHVybiB0aGlzLmNoYXRfaWQucmVwbGFjZSgvXHUyMDE0W15cdTIwMTRdKiQvLFwiXCIpO1xuICAgIH1cbiAgICByZXR1cm4gXCJVTlRJVExFRFwiO1xuICB9XG5cbiAgZ2V0X2ZpbGVfZGF0ZV9zdHJpbmcoKSB7XG4gICAgcmV0dXJuIG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5yZXBsYWNlKC8oVHw6fFxcLi4qKS9nLCBcIiBcIikudHJpbSgpO1xuICB9XG4gIC8vIGdldCByZXNwb25zZSBmcm9tIHdpdGggbm90ZSBjb250ZXh0XG4gIGFzeW5jIGdldF9yZXNwb25zZV93aXRoX25vdGVfY29udGV4dCh1c2VyX2lucHV0LCBjaGF0X3ZpZXcpIHtcbiAgICBsZXQgc3lzdGVtX2lucHV0ID0gXCJJbWFnaW5lIHRoZSBmb2xsb3dpbmcgbm90ZXMgd2VyZSB3cml0dGVuIGJ5IHRoZSB1c2VyIGFuZCBjb250YWluIHRoZSBuZWNlc3NhcnkgaW5mb3JtYXRpb24gdG8gc3ludGhlc2l6ZSBhIHVzZWZ1bCBhbnN3ZXIgdGhlIHVzZXIncyBxdWVyeTpcXG5cIjtcbiAgICAvLyBleHRyYWN0IGludGVybmFsIGxpbmtzXG4gICAgY29uc3Qgbm90ZXMgPSB0aGlzLmV4dHJhY3RfaW50ZXJuYWxfbGlua3ModXNlcl9pbnB1dCk7XG4gICAgLy8gZ2V0IGNvbnRlbnQgb2YgaW50ZXJuYWwgbGlua3MgYXMgY29udGV4dFxuICAgIGxldCBtYXhfY2hhcnMgPSBnZXRfbWF4X2NoYXJzKHRoaXMucGx1Z2luLnNldHRpbmdzLnNtYXJ0X2NoYXRfbW9kZWwpO1xuICAgIGZvcihsZXQgaSA9IDA7IGkgPCBub3Rlcy5sZW5ndGg7IGkrKyl7XG4gICAgICAvLyBtYXggY2hhcnMgZm9yIHRoaXMgbm90ZSBpcyBtYXhfY2hhcnMgZGl2aWRlZCBieSBudW1iZXIgb2Ygbm90ZXMgbGVmdFxuICAgICAgY29uc3QgdGhpc19tYXhfY2hhcnMgPSAobm90ZXMubGVuZ3RoIC0gaSA+IDEpID8gTWF0aC5mbG9vcihtYXhfY2hhcnMgLyAobm90ZXMubGVuZ3RoIC0gaSkpIDogbWF4X2NoYXJzO1xuICAgICAgLy8gY29uc29sZS5sb2coXCJmaWxlIGNvbnRleHQgbWF4IGNoYXJzOiBcIiArIHRoaXNfbWF4X2NoYXJzKTtcbiAgICAgIGNvbnN0IG5vdGVfY29udGVudCA9IGF3YWl0IHRoaXMuZ2V0X25vdGVfY29udGVudHMobm90ZXNbaV0sIHtjaGFyX2xpbWl0OiB0aGlzX21heF9jaGFyc30pO1xuICAgICAgc3lzdGVtX2lucHV0ICs9IGAtLS1CRUdJTiBOT1RFOiBbWyR7bm90ZXNbaV0uYmFzZW5hbWV9XV0tLS1cXG5gXG4gICAgICBzeXN0ZW1faW5wdXQgKz0gbm90ZV9jb250ZW50O1xuICAgICAgc3lzdGVtX2lucHV0ICs9IGAtLS1FTkQgTk9URS0tLVxcbmBcbiAgICAgIG1heF9jaGFycyAtPSBub3RlX2NvbnRlbnQubGVuZ3RoO1xuICAgICAgaWYobWF4X2NoYXJzIDw9IDApIGJyZWFrO1xuICAgIH1cbiAgICB0aGlzLmNvbnRleHQgPSBzeXN0ZW1faW5wdXQ7XG4gICAgY29uc3QgY2hhdG1sID0gW1xuICAgICAge1xuICAgICAgICByb2xlOiBcInN5c3RlbVwiLFxuICAgICAgICBjb250ZW50OiBzeXN0ZW1faW5wdXRcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIHJvbGU6IFwidXNlclwiLFxuICAgICAgICBjb250ZW50OiB1c2VyX2lucHV0XG4gICAgICB9XG4gICAgXTtcbiAgICBjaGF0X3ZpZXcucmVxdWVzdF9jaGF0Z3B0X2NvbXBsZXRpb24oe21lc3NhZ2VzOiBjaGF0bWwsIHRlbXBlcmF0dXJlOiAwfSk7XG4gIH1cbiAgLy8gY2hlY2sgaWYgY29udGFpbnMgaW50ZXJuYWwgbGlua1xuICBjb250YWluc19pbnRlcm5hbF9saW5rKHVzZXJfaW5wdXQpIHtcbiAgICBpZih1c2VyX2lucHV0LmluZGV4T2YoXCJbW1wiKSA9PT0gLTEpIHJldHVybiBmYWxzZTtcbiAgICBpZih1c2VyX2lucHV0LmluZGV4T2YoXCJdXVwiKSA9PT0gLTEpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuICAvLyBjaGVjayBpZiBjb250YWlucyBmb2xkZXIgcmVmZXJlbmNlIChleC4gL2ZvbGRlci8sIG9yIC9mb2xkZXIvc3ViZm9sZGVyLylcbiAgY29udGFpbnNfZm9sZGVyX3JlZmVyZW5jZSh1c2VyX2lucHV0KSB7XG4gICAgaWYodXNlcl9pbnB1dC5pbmRleE9mKFwiL1wiKSA9PT0gLTEpIHJldHVybiBmYWxzZTtcbiAgICBpZih1c2VyX2lucHV0LmluZGV4T2YoXCIvXCIpID09PSB1c2VyX2lucHV0Lmxhc3RJbmRleE9mKFwiL1wiKSkgcmV0dXJuIGZhbHNlO1xuICAgIHJldHVybiB0cnVlO1xuICB9XG4gIC8vIGdldCBmb2xkZXIgcmVmZXJlbmNlcyBmcm9tIHVzZXIgaW5wdXRcbiAgZ2V0X2ZvbGRlcl9yZWZlcmVuY2VzKHVzZXJfaW5wdXQpIHtcbiAgICAvLyB1c2UgdGhpcy5mb2xkZXJzIHRvIGV4dHJhY3QgZm9sZGVyIHJlZmVyZW5jZXMgYnkgbG9uZ2VzdCBmaXJzdCAoZXguIC9mb2xkZXIvc3ViZm9sZGVyLyBiZWZvcmUgL2ZvbGRlci8pIHRvIGF2b2lkIG1hdGNoaW5nIC9mb2xkZXIvc3ViZm9sZGVyLyBhcyAvZm9sZGVyL1xuICAgIGNvbnN0IGZvbGRlcnMgPSB0aGlzLnBsdWdpbi5mb2xkZXJzLnNsaWNlKCk7IC8vIGNvcHkgZm9sZGVycyBhcnJheVxuICAgIGNvbnN0IG1hdGNoZXMgPSBmb2xkZXJzLnNvcnQoKGEsIGIpID0+IGIubGVuZ3RoIC0gYS5sZW5ndGgpLm1hcChmb2xkZXIgPT4ge1xuICAgICAgLy8gY2hlY2sgaWYgZm9sZGVyIGlzIGluIHVzZXJfaW5wdXRcbiAgICAgIGlmKHVzZXJfaW5wdXQuaW5kZXhPZihmb2xkZXIpICE9PSAtMSl7XG4gICAgICAgIC8vIHJlbW92ZSBmb2xkZXIgZnJvbSB1c2VyX2lucHV0IHRvIHByZXZlbnQgbWF0Y2hpbmcgL2ZvbGRlci9zdWJmb2xkZXIvIGFzIC9mb2xkZXIvXG4gICAgICAgIHVzZXJfaW5wdXQgPSB1c2VyX2lucHV0LnJlcGxhY2UoZm9sZGVyLCBcIlwiKTtcbiAgICAgICAgcmV0dXJuIGZvbGRlcjtcbiAgICAgIH1cbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9KS5maWx0ZXIoZm9sZGVyID0+IGZvbGRlcik7XG4gICAgY29uc29sZS5sb2cobWF0Y2hlcyk7XG4gICAgLy8gcmV0dXJuIGFycmF5IG9mIG1hdGNoZXNcbiAgICBpZihtYXRjaGVzKSByZXR1cm4gbWF0Y2hlcztcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuXG4gIC8vIGV4dHJhY3QgaW50ZXJuYWwgbGlua3NcbiAgZXh0cmFjdF9pbnRlcm5hbF9saW5rcyh1c2VyX2lucHV0KSB7XG4gICAgY29uc3QgbWF0Y2hlcyA9IHVzZXJfaW5wdXQubWF0Y2goL1xcW1xcWyguKj8pXFxdXFxdL2cpO1xuICAgIGNvbnNvbGUubG9nKG1hdGNoZXMpO1xuICAgIC8vIHJldHVybiBhcnJheSBvZiBURmlsZSBvYmplY3RzXG4gICAgaWYobWF0Y2hlcykgcmV0dXJuIG1hdGNoZXMubWFwKG1hdGNoID0+IHtcbiAgICAgIHJldHVybiB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpcnN0TGlua3BhdGhEZXN0KG1hdGNoLnJlcGxhY2UoXCJbW1wiLCBcIlwiKS5yZXBsYWNlKFwiXV1cIiwgXCJcIiksIFwiL1wiKTtcbiAgICB9KTtcbiAgICByZXR1cm4gW107XG4gIH1cbiAgLy8gZ2V0IGNvbnRleHQgZnJvbSBpbnRlcm5hbCBsaW5rc1xuICBhc3luYyBnZXRfbm90ZV9jb250ZW50cyhub3RlLCBvcHRzPXt9KSB7XG4gICAgb3B0cyA9IHtcbiAgICAgIGNoYXJfbGltaXQ6IDEwMDAwLFxuICAgICAgLi4ub3B0c1xuICAgIH1cbiAgICAvLyByZXR1cm4gaWYgbm90ZSBpcyBub3QgYSBmaWxlXG4gICAgaWYoIShub3RlIGluc3RhbmNlb2YgT2JzaWRpYW4uVEZpbGUpKSByZXR1cm4gXCJcIjtcbiAgICAvLyBnZXQgZmlsZSBjb250ZW50XG4gICAgbGV0IGZpbGVfY29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQobm90ZSk7XG4gICAgLy8gY2hlY2sgaWYgY29udGFpbnMgZGF0YXZpZXcgY29kZSBibG9ja1xuICAgIGlmKGZpbGVfY29udGVudC5pbmRleE9mKFwiYGBgZGF0YXZpZXdcIikgPiAtMSl7XG4gICAgICAvLyBpZiBjb250YWlucyBkYXRhdmlldyBjb2RlIGJsb2NrIGdldCBhbGwgZGF0YXZpZXcgY29kZSBibG9ja3NcbiAgICAgIGZpbGVfY29udGVudCA9IGF3YWl0IHRoaXMucmVuZGVyX2RhdGF2aWV3X3F1ZXJpZXMoZmlsZV9jb250ZW50LCBub3RlLnBhdGgsIG9wdHMpO1xuICAgIH1cbiAgICBmaWxlX2NvbnRlbnQgPSBmaWxlX2NvbnRlbnQuc3Vic3RyaW5nKDAsIG9wdHMuY2hhcl9saW1pdCk7XG4gICAgLy8gY29uc29sZS5sb2coZmlsZV9jb250ZW50Lmxlbmd0aCk7XG4gICAgcmV0dXJuIGZpbGVfY29udGVudDtcbiAgfVxuXG5cbiAgYXN5bmMgcmVuZGVyX2RhdGF2aWV3X3F1ZXJpZXMoZmlsZV9jb250ZW50LCBub3RlX3BhdGgsIG9wdHM9e30pIHtcbiAgICBvcHRzID0ge1xuICAgICAgY2hhcl9saW1pdDogbnVsbCxcbiAgICAgIC4uLm9wdHNcbiAgICB9O1xuICAgIC8vIHVzZSB3aW5kb3cgdG8gZ2V0IGRhdGF2aWV3IGFwaVxuICAgIGNvbnN0IGRhdGF2aWV3X2FwaSA9IHdpbmRvd1tcIkRhdGF2aWV3QVBJXCJdO1xuICAgIC8vIHNraXAgaWYgZGF0YXZpZXcgYXBpIG5vdCBmb3VuZFxuICAgIGlmKCFkYXRhdmlld19hcGkpIHJldHVybiBmaWxlX2NvbnRlbnQ7XG4gICAgY29uc3QgZGF0YXZpZXdfY29kZV9ibG9ja3MgPSBmaWxlX2NvbnRlbnQubWF0Y2goL2BgYGRhdGF2aWV3KC4qPylgYGAvZ3MpO1xuICAgIC8vIGZvciBlYWNoIGRhdGF2aWV3IGNvZGUgYmxvY2tcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRhdGF2aWV3X2NvZGVfYmxvY2tzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAvLyBpZiBvcHRzIGNoYXJfbGltaXQgaXMgbGVzcyB0aGFuIGluZGV4T2YgZGF0YXZpZXcgY29kZSBibG9jaywgYnJlYWtcbiAgICAgIGlmKG9wdHMuY2hhcl9saW1pdCAmJiBvcHRzLmNoYXJfbGltaXQgPCBmaWxlX2NvbnRlbnQuaW5kZXhPZihkYXRhdmlld19jb2RlX2Jsb2Nrc1tpXSkpIGJyZWFrO1xuICAgICAgLy8gZ2V0IGRhdGF2aWV3IGNvZGUgYmxvY2tcbiAgICAgIGNvbnN0IGRhdGF2aWV3X2NvZGVfYmxvY2sgPSBkYXRhdmlld19jb2RlX2Jsb2Nrc1tpXTtcbiAgICAgIC8vIGdldCBjb250ZW50IG9mIGRhdGF2aWV3IGNvZGUgYmxvY2tcbiAgICAgIGNvbnN0IGRhdGF2aWV3X2NvZGVfYmxvY2tfY29udGVudCA9IGRhdGF2aWV3X2NvZGVfYmxvY2sucmVwbGFjZShcImBgYGRhdGF2aWV3XCIsIFwiXCIpLnJlcGxhY2UoXCJgYGBcIiwgXCJcIik7XG4gICAgICAvLyBnZXQgZGF0YXZpZXcgcXVlcnkgcmVzdWx0XG4gICAgICBjb25zdCBkYXRhdmlld19xdWVyeV9yZXN1bHQgPSBhd2FpdCBkYXRhdmlld19hcGkucXVlcnlNYXJrZG93bihkYXRhdmlld19jb2RlX2Jsb2NrX2NvbnRlbnQsIG5vdGVfcGF0aCwgbnVsbCk7XG4gICAgICAvLyBpZiBxdWVyeSByZXN1bHQgaXMgc3VjY2Vzc2Z1bCwgcmVwbGFjZSBkYXRhdmlldyBjb2RlIGJsb2NrIHdpdGggcXVlcnkgcmVzdWx0XG4gICAgICBpZiAoZGF0YXZpZXdfcXVlcnlfcmVzdWx0LnN1Y2Nlc3NmdWwpIHtcbiAgICAgICAgZmlsZV9jb250ZW50ID0gZmlsZV9jb250ZW50LnJlcGxhY2UoZGF0YXZpZXdfY29kZV9ibG9jaywgZGF0YXZpZXdfcXVlcnlfcmVzdWx0LnZhbHVlKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGZpbGVfY29udGVudDtcbiAgfVxufVxuXG5jbGFzcyBTbWFydENvbm5lY3Rpb25zQ2hhdEhpc3RvcnlNb2RhbCBleHRlbmRzIE9ic2lkaWFuLkZ1enp5U3VnZ2VzdE1vZGFsIHtcbiAgY29uc3RydWN0b3IoYXBwLCB2aWV3LCBmaWxlcykge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5hcHAgPSBhcHA7XG4gICAgdGhpcy52aWV3ID0gdmlldztcbiAgICB0aGlzLnNldFBsYWNlaG9sZGVyKFwiVHlwZSB0aGUgbmFtZSBvZiBhIGNoYXQgc2Vzc2lvbi4uLlwiKTtcbiAgfVxuICBnZXRJdGVtcygpIHtcbiAgICBpZiAoIXRoaXMudmlldy5maWxlcykge1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy52aWV3LmZpbGVzO1xuICB9XG4gIGdldEl0ZW1UZXh0KGl0ZW0pIHtcbiAgICAvLyBpZiBub3QgVU5USVRMRUQsIHJlbW92ZSBkYXRlIGFmdGVyIGxhc3QgZW0gZGFzaFxuICAgIGlmKGl0ZW0uaW5kZXhPZihcIlVOVElUTEVEXCIpID09PSAtMSl7XG4gICAgICBpdGVtLnJlcGxhY2UoL1x1MjAxNFteXHUyMDE0XSokLyxcIlwiKTtcbiAgICB9XG4gICAgcmV0dXJuIGl0ZW07XG4gIH1cbiAgb25DaG9vc2VJdGVtKHNlc3Npb24pIHtcbiAgICB0aGlzLnZpZXcub3Blbl9jaGF0KHNlc3Npb24pO1xuICB9XG59XG5cbi8vIEZpbGUgU2VsZWN0IEZ1enp5IFN1Z2dlc3QgTW9kYWxcbmNsYXNzIFNtYXJ0Q29ubmVjdGlvbnNGaWxlU2VsZWN0TW9kYWwgZXh0ZW5kcyBPYnNpZGlhbi5GdXp6eVN1Z2dlc3RNb2RhbCB7XG4gIGNvbnN0cnVjdG9yKGFwcCwgdmlldykge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5hcHAgPSBhcHA7XG4gICAgdGhpcy52aWV3ID0gdmlldztcbiAgICB0aGlzLnNldFBsYWNlaG9sZGVyKFwiVHlwZSB0aGUgbmFtZSBvZiBhIGZpbGUuLi5cIik7XG4gIH1cbiAgZ2V0SXRlbXMoKSB7XG4gICAgLy8gZ2V0IGFsbCBtYXJrZG93biBmaWxlc1xuICAgIHJldHVybiB0aGlzLmFwcC52YXVsdC5nZXRNYXJrZG93bkZpbGVzKCkuc29ydCgoYSwgYikgPT4gYS5iYXNlbmFtZS5sb2NhbGVDb21wYXJlKGIuYmFzZW5hbWUpKTtcbiAgfVxuICBnZXRJdGVtVGV4dChpdGVtKSB7XG4gICAgcmV0dXJuIGl0ZW0uYmFzZW5hbWU7XG4gIH1cbiAgb25DaG9vc2VJdGVtKGZpbGUpIHtcbiAgICB0aGlzLnZpZXcuaW5zZXJ0X3NlbGVjdGlvbihmaWxlLmJhc2VuYW1lICsgXCJdXSBcIik7XG4gIH1cbn1cbi8vIEZvbGRlciBTZWxlY3QgRnV6enkgU3VnZ2VzdCBNb2RhbFxuY2xhc3MgU21hcnRDb25uZWN0aW9uc0ZvbGRlclNlbGVjdE1vZGFsIGV4dGVuZHMgT2JzaWRpYW4uRnV6enlTdWdnZXN0TW9kYWwge1xuICBjb25zdHJ1Y3RvcihhcHAsIHZpZXcpIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMuYXBwID0gYXBwO1xuICAgIHRoaXMudmlldyA9IHZpZXc7XG4gICAgdGhpcy5zZXRQbGFjZWhvbGRlcihcIlR5cGUgdGhlIG5hbWUgb2YgYSBmb2xkZXIuLi5cIik7XG4gIH1cbiAgZ2V0SXRlbXMoKSB7XG4gICAgcmV0dXJuIHRoaXMudmlldy5wbHVnaW4uZm9sZGVycztcbiAgfVxuICBnZXRJdGVtVGV4dChpdGVtKSB7XG4gICAgcmV0dXJuIGl0ZW07XG4gIH1cbiAgb25DaG9vc2VJdGVtKGZvbGRlcikge1xuICAgIHRoaXMudmlldy5pbnNlcnRfc2VsZWN0aW9uKGZvbGRlciArIFwiLyBcIik7XG4gIH1cbn1cblxuXG4vLyBIYW5kbGUgQVBJIHJlc3BvbnNlIHN0cmVhbWluZ1xuY2xhc3MgU2NTdHJlYW1lciB7XG4gIC8vIGNvbnN0cnVjdG9yXG4gIGNvbnN0cnVjdG9yKHVybCwgb3B0aW9ucykge1xuICAgIC8vIHNldCBkZWZhdWx0IG9wdGlvbnNcbiAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcbiAgICB0aGlzLnVybCA9IHVybDtcbiAgICB0aGlzLm1ldGhvZCA9IG9wdGlvbnMubWV0aG9kIHx8ICdHRVQnO1xuICAgIHRoaXMuaGVhZGVycyA9IG9wdGlvbnMuaGVhZGVycyB8fCB7fTtcbiAgICB0aGlzLnBheWxvYWQgPSBvcHRpb25zLnBheWxvYWQgfHwgbnVsbDtcbiAgICB0aGlzLndpdGhDcmVkZW50aWFscyA9IG9wdGlvbnMud2l0aENyZWRlbnRpYWxzIHx8IGZhbHNlO1xuICAgIHRoaXMubGlzdGVuZXJzID0ge307XG4gICAgdGhpcy5yZWFkeVN0YXRlID0gdGhpcy5DT05ORUNUSU5HO1xuICAgIHRoaXMucHJvZ3Jlc3MgPSAwO1xuICAgIHRoaXMuY2h1bmsgPSAnJztcbiAgICB0aGlzLnhociA9IG51bGw7XG4gICAgdGhpcy5GSUVMRF9TRVBBUkFUT1IgPSAnOic7XG4gICAgdGhpcy5JTklUSUFMSVpJTkcgPSAtMTtcbiAgICB0aGlzLkNPTk5FQ1RJTkcgPSAwO1xuICAgIHRoaXMuT1BFTiA9IDE7XG4gICAgdGhpcy5DTE9TRUQgPSAyO1xuICB9XG4gIC8vIGFkZEV2ZW50TGlzdGVuZXJcbiAgYWRkRXZlbnRMaXN0ZW5lcih0eXBlLCBsaXN0ZW5lcikge1xuICAgIC8vIGNoZWNrIGlmIHRoZSB0eXBlIGlzIGluIHRoZSBsaXN0ZW5lcnNcbiAgICBpZiAoIXRoaXMubGlzdGVuZXJzW3R5cGVdKSB7XG4gICAgICB0aGlzLmxpc3RlbmVyc1t0eXBlXSA9IFtdO1xuICAgIH1cbiAgICAvLyBjaGVjayBpZiB0aGUgbGlzdGVuZXIgaXMgYWxyZWFkeSBpbiB0aGUgbGlzdGVuZXJzXG4gICAgaWYodGhpcy5saXN0ZW5lcnNbdHlwZV0uaW5kZXhPZihsaXN0ZW5lcikgPT09IC0xKSB7XG4gICAgICB0aGlzLmxpc3RlbmVyc1t0eXBlXS5wdXNoKGxpc3RlbmVyKTtcbiAgICB9XG4gIH1cbiAgLy8gcmVtb3ZlRXZlbnRMaXN0ZW5lclxuICByZW1vdmVFdmVudExpc3RlbmVyKHR5cGUsIGxpc3RlbmVyKSB7XG4gICAgLy8gY2hlY2sgaWYgbGlzdGVuZXIgdHlwZSBpcyB1bmRlZmluZWRcbiAgICBpZiAoIXRoaXMubGlzdGVuZXJzW3R5cGVdKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGxldCBmaWx0ZXJlZCA9IFtdO1xuICAgIC8vIGxvb3AgdGhyb3VnaCB0aGUgbGlzdGVuZXJzXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aGlzLmxpc3RlbmVyc1t0eXBlXS5sZW5ndGg7IGkrKykge1xuICAgICAgLy8gY2hlY2sgaWYgdGhlIGxpc3RlbmVyIGlzIHRoZSBzYW1lXG4gICAgICBpZiAodGhpcy5saXN0ZW5lcnNbdHlwZV1baV0gIT09IGxpc3RlbmVyKSB7XG4gICAgICAgIGZpbHRlcmVkLnB1c2godGhpcy5saXN0ZW5lcnNbdHlwZV1baV0pO1xuICAgICAgfVxuICAgIH1cbiAgICAvLyBjaGVjayBpZiB0aGUgbGlzdGVuZXJzIGFyZSBlbXB0eVxuICAgIGlmICh0aGlzLmxpc3RlbmVyc1t0eXBlXS5sZW5ndGggPT09IDApIHtcbiAgICAgIGRlbGV0ZSB0aGlzLmxpc3RlbmVyc1t0eXBlXTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5saXN0ZW5lcnNbdHlwZV0gPSBmaWx0ZXJlZDtcbiAgICB9XG4gIH1cbiAgLy8gZGlzcGF0Y2hFdmVudFxuICBkaXNwYXRjaEV2ZW50KGV2ZW50KSB7XG4gICAgLy8gaWYgbm8gZXZlbnQgcmV0dXJuIHRydWVcbiAgICBpZiAoIWV2ZW50KSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgLy8gc2V0IGV2ZW50IHNvdXJjZSB0byB0aGlzXG4gICAgZXZlbnQuc291cmNlID0gdGhpcztcbiAgICAvLyBzZXQgb25IYW5kbGVyIHRvIG9uICsgZXZlbnQgdHlwZVxuICAgIGxldCBvbkhhbmRsZXIgPSAnb24nICsgZXZlbnQudHlwZTtcbiAgICAvLyBjaGVjayBpZiB0aGUgb25IYW5kbGVyIGhhcyBvd24gcHJvcGVydHkgbmFtZWQgc2FtZSBhcyBvbkhhbmRsZXJcbiAgICBpZiAodGhpcy5oYXNPd25Qcm9wZXJ0eShvbkhhbmRsZXIpKSB7XG4gICAgICAvLyBjYWxsIHRoZSBvbkhhbmRsZXJcbiAgICAgIHRoaXNbb25IYW5kbGVyXS5jYWxsKHRoaXMsIGV2ZW50KTtcbiAgICAgIC8vIGNoZWNrIGlmIHRoZSBldmVudCBpcyBkZWZhdWx0IHByZXZlbnRlZFxuICAgICAgaWYgKGV2ZW50LmRlZmF1bHRQcmV2ZW50ZWQpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgIH1cbiAgICAvLyBjaGVjayBpZiB0aGUgZXZlbnQgdHlwZSBpcyBpbiB0aGUgbGlzdGVuZXJzXG4gICAgaWYgKHRoaXMubGlzdGVuZXJzW2V2ZW50LnR5cGVdKSB7XG4gICAgICByZXR1cm4gdGhpcy5saXN0ZW5lcnNbZXZlbnQudHlwZV0uZXZlcnkoZnVuY3Rpb24oY2FsbGJhY2spIHtcbiAgICAgICAgY2FsbGJhY2soZXZlbnQpO1xuICAgICAgICByZXR1cm4gIWV2ZW50LmRlZmF1bHRQcmV2ZW50ZWQ7XG4gICAgICB9KTtcbiAgICB9XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cbiAgLy8gX3NldFJlYWR5U3RhdGVcbiAgX3NldFJlYWR5U3RhdGUoc3RhdGUpIHtcbiAgICAvLyBzZXQgZXZlbnQgdHlwZSB0byByZWFkeVN0YXRlQ2hhbmdlXG4gICAgbGV0IGV2ZW50ID0gbmV3IEN1c3RvbUV2ZW50KCdyZWFkeVN0YXRlQ2hhbmdlJyk7XG4gICAgLy8gc2V0IGV2ZW50IHJlYWR5U3RhdGUgdG8gc3RhdGVcbiAgICBldmVudC5yZWFkeVN0YXRlID0gc3RhdGU7XG4gICAgLy8gc2V0IHJlYWR5U3RhdGUgdG8gc3RhdGVcbiAgICB0aGlzLnJlYWR5U3RhdGUgPSBzdGF0ZTtcbiAgICAvLyBkaXNwYXRjaCBldmVudFxuICAgIHRoaXMuZGlzcGF0Y2hFdmVudChldmVudCk7XG4gIH1cbiAgLy8gX29uU3RyZWFtRmFpbHVyZVxuICBfb25TdHJlYW1GYWlsdXJlKGUpIHtcbiAgICAvLyBzZXQgZXZlbnQgdHlwZSB0byBlcnJvclxuICAgIGxldCBldmVudCA9IG5ldyBDdXN0b21FdmVudCgnZXJyb3InKTtcbiAgICAvLyBzZXQgZXZlbnQgZGF0YSB0byBlXG4gICAgZXZlbnQuZGF0YSA9IGUuY3VycmVudFRhcmdldC5yZXNwb25zZTtcbiAgICAvLyBkaXNwYXRjaCBldmVudFxuICAgIHRoaXMuZGlzcGF0Y2hFdmVudChldmVudCk7XG4gICAgdGhpcy5jbG9zZSgpO1xuICB9XG4gIC8vIF9vblN0cmVhbUFib3J0XG4gIF9vblN0cmVhbUFib3J0KGUpIHtcbiAgICAvLyBzZXQgdG8gYWJvcnRcbiAgICBsZXQgZXZlbnQgPSBuZXcgQ3VzdG9tRXZlbnQoJ2Fib3J0Jyk7XG4gICAgLy8gY2xvc2VcbiAgICB0aGlzLmNsb3NlKCk7XG4gIH1cbiAgLy8gX29uU3RyZWFtUHJvZ3Jlc3NcbiAgX29uU3RyZWFtUHJvZ3Jlc3MoZSkge1xuICAgIC8vIGlmIG5vdCB4aHIgcmV0dXJuXG4gICAgaWYgKCF0aGlzLnhocikge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICAvLyBpZiB4aHIgc3RhdHVzIGlzIG5vdCAyMDAgcmV0dXJuXG4gICAgaWYgKHRoaXMueGhyLnN0YXR1cyAhPT0gMjAwKSB7XG4gICAgICAvLyBvblN0cmVhbUZhaWx1cmVcbiAgICAgIHRoaXMuX29uU3RyZWFtRmFpbHVyZShlKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgLy8gaWYgcmVhZHkgc3RhdGUgaXMgQ09OTkVDVElOR1xuICAgIGlmICh0aGlzLnJlYWR5U3RhdGUgPT09IHRoaXMuQ09OTkVDVElORykge1xuICAgICAgLy8gZGlzcGF0Y2ggZXZlbnRcbiAgICAgIHRoaXMuZGlzcGF0Y2hFdmVudChuZXcgQ3VzdG9tRXZlbnQoJ29wZW4nKSk7XG4gICAgICAvLyBzZXQgcmVhZHkgc3RhdGUgdG8gT1BFTlxuICAgICAgdGhpcy5fc2V0UmVhZHlTdGF0ZSh0aGlzLk9QRU4pO1xuICAgIH1cbiAgICAvLyBwYXJzZSB0aGUgcmVjZWl2ZWQgZGF0YS5cbiAgICBsZXQgZGF0YSA9IHRoaXMueGhyLnJlc3BvbnNlVGV4dC5zdWJzdHJpbmcodGhpcy5wcm9ncmVzcyk7XG4gICAgLy8gdXBkYXRlIHByb2dyZXNzXG4gICAgdGhpcy5wcm9ncmVzcyArPSBkYXRhLmxlbmd0aDtcbiAgICAvLyBzcGxpdCB0aGUgZGF0YSBieSBuZXcgbGluZSBhbmQgcGFyc2UgZWFjaCBsaW5lXG4gICAgZGF0YS5zcGxpdCgvKFxcclxcbnxcXHJ8XFxuKXsyfS9nKS5mb3JFYWNoKGZ1bmN0aW9uKHBhcnQpe1xuICAgICAgaWYocGFydC50cmltKCkubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHRoaXMuZGlzcGF0Y2hFdmVudCh0aGlzLl9wYXJzZUV2ZW50Q2h1bmsodGhpcy5jaHVuay50cmltKCkpKTtcbiAgICAgICAgdGhpcy5jaHVuayA9ICcnO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5jaHVuayArPSBwYXJ0O1xuICAgICAgfVxuICAgIH0uYmluZCh0aGlzKSk7XG4gIH1cbiAgLy8gX29uU3RyZWFtTG9hZGVkXG4gIF9vblN0cmVhbUxvYWRlZChlKSB7XG4gICAgdGhpcy5fb25TdHJlYW1Qcm9ncmVzcyhlKTtcbiAgICAvLyBwYXJzZSB0aGUgbGFzdCBjaHVua1xuICAgIHRoaXMuZGlzcGF0Y2hFdmVudCh0aGlzLl9wYXJzZUV2ZW50Q2h1bmsodGhpcy5jaHVuaykpO1xuICAgIHRoaXMuY2h1bmsgPSAnJztcbiAgfVxuICAvLyBfcGFyc2VFdmVudENodW5rXG4gIF9wYXJzZUV2ZW50Q2h1bmsoY2h1bmspIHtcbiAgICAvLyBpZiBubyBjaHVuayBvciBjaHVuayBpcyBlbXB0eSByZXR1cm5cbiAgICBpZiAoIWNodW5rIHx8IGNodW5rLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIC8vIGluaXQgZVxuICAgIGxldCBlID0ge2lkOiBudWxsLCByZXRyeTogbnVsbCwgZGF0YTogJycsIGV2ZW50OiAnbWVzc2FnZSd9O1xuICAgIC8vIHNwbGl0IHRoZSBjaHVuayBieSBuZXcgbGluZVxuICAgIGNodW5rLnNwbGl0KC8oXFxyXFxufFxccnxcXG4pLykuZm9yRWFjaChmdW5jdGlvbihsaW5lKSB7XG4gICAgICBsaW5lID0gbGluZS50cmltUmlnaHQoKTtcbiAgICAgIGxldCBpbmRleCA9IGxpbmUuaW5kZXhPZih0aGlzLkZJRUxEX1NFUEFSQVRPUik7XG4gICAgICBpZihpbmRleCA8PSAwKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIC8vIGZpZWxkXG4gICAgICBsZXQgZmllbGQgPSBsaW5lLnN1YnN0cmluZygwLCBpbmRleCk7XG4gICAgICBpZighKGZpZWxkIGluIGUpKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIC8vIHZhbHVlXG4gICAgICBsZXQgdmFsdWUgPSBsaW5lLnN1YnN0cmluZyhpbmRleCArIDEpLnRyaW1MZWZ0KCk7XG4gICAgICBpZihmaWVsZCA9PT0gJ2RhdGEnKSB7XG4gICAgICAgIGVbZmllbGRdICs9IHZhbHVlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZVtmaWVsZF0gPSB2YWx1ZTtcbiAgICAgIH1cbiAgICB9LmJpbmQodGhpcykpO1xuICAgIC8vIHJldHVybiBldmVudFxuICAgIGxldCBldmVudCA9IG5ldyBDdXN0b21FdmVudChlLmV2ZW50KTtcbiAgICBldmVudC5kYXRhID0gZS5kYXRhO1xuICAgIGV2ZW50LmlkID0gZS5pZDtcbiAgICByZXR1cm4gZXZlbnQ7XG4gIH1cbiAgLy8gX2NoZWNrU3RyZWFtQ2xvc2VkXG4gIF9jaGVja1N0cmVhbUNsb3NlZCgpIHtcbiAgICBpZighdGhpcy54aHIpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYodGhpcy54aHIucmVhZHlTdGF0ZSA9PT0gWE1MSHR0cFJlcXVlc3QuRE9ORSkge1xuICAgICAgdGhpcy5fc2V0UmVhZHlTdGF0ZSh0aGlzLkNMT1NFRCk7XG4gICAgfVxuICB9XG4gIC8vIHN0cmVhbVxuICBzdHJlYW0oKSB7XG4gICAgLy8gc2V0IHJlYWR5IHN0YXRlIHRvIGNvbm5lY3RpbmdcbiAgICB0aGlzLl9zZXRSZWFkeVN0YXRlKHRoaXMuQ09OTkVDVElORyk7XG4gICAgLy8gc2V0IHhociB0byBuZXcgWE1MSHR0cFJlcXVlc3RcbiAgICB0aGlzLnhociA9IG5ldyBYTUxIdHRwUmVxdWVzdCgpO1xuICAgIC8vIHNldCB4aHIgcHJvZ3Jlc3MgdG8gX29uU3RyZWFtUHJvZ3Jlc3NcbiAgICB0aGlzLnhoci5hZGRFdmVudExpc3RlbmVyKCdwcm9ncmVzcycsIHRoaXMuX29uU3RyZWFtUHJvZ3Jlc3MuYmluZCh0aGlzKSk7XG4gICAgLy8gc2V0IHhociBsb2FkIHRvIF9vblN0cmVhbUxvYWRlZFxuICAgIHRoaXMueGhyLmFkZEV2ZW50TGlzdGVuZXIoJ2xvYWQnLCB0aGlzLl9vblN0cmVhbUxvYWRlZC5iaW5kKHRoaXMpKTtcbiAgICAvLyBzZXQgeGhyIHJlYWR5IHN0YXRlIGNoYW5nZSB0byBfY2hlY2tTdHJlYW1DbG9zZWRcbiAgICB0aGlzLnhoci5hZGRFdmVudExpc3RlbmVyKCdyZWFkeXN0YXRlY2hhbmdlJywgdGhpcy5fY2hlY2tTdHJlYW1DbG9zZWQuYmluZCh0aGlzKSk7XG4gICAgLy8gc2V0IHhociBlcnJvciB0byBfb25TdHJlYW1GYWlsdXJlXG4gICAgdGhpcy54aHIuYWRkRXZlbnRMaXN0ZW5lcignZXJyb3InLCB0aGlzLl9vblN0cmVhbUZhaWx1cmUuYmluZCh0aGlzKSk7XG4gICAgLy8gc2V0IHhociBhYm9ydCB0byBfb25TdHJlYW1BYm9ydFxuICAgIHRoaXMueGhyLmFkZEV2ZW50TGlzdGVuZXIoJ2Fib3J0JywgdGhpcy5fb25TdHJlYW1BYm9ydC5iaW5kKHRoaXMpKTtcbiAgICAvLyBvcGVuIHhoclxuICAgIHRoaXMueGhyLm9wZW4odGhpcy5tZXRob2QsIHRoaXMudXJsKTtcbiAgICAvLyBoZWFkZXJzIHRvIHhoclxuICAgIGZvciAobGV0IGhlYWRlciBpbiB0aGlzLmhlYWRlcnMpIHtcbiAgICAgIHRoaXMueGhyLnNldFJlcXVlc3RIZWFkZXIoaGVhZGVyLCB0aGlzLmhlYWRlcnNbaGVhZGVyXSk7XG4gICAgfVxuICAgIC8vIGNyZWRlbnRpYWxzIHRvIHhoclxuICAgIHRoaXMueGhyLndpdGhDcmVkZW50aWFscyA9IHRoaXMud2l0aENyZWRlbnRpYWxzO1xuICAgIC8vIHNlbmQgeGhyXG4gICAgdGhpcy54aHIuc2VuZCh0aGlzLnBheWxvYWQpO1xuICB9XG4gIC8vIGNsb3NlXG4gIGNsb3NlKCkge1xuICAgIGlmKHRoaXMucmVhZHlTdGF0ZSA9PT0gdGhpcy5DTE9TRUQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy54aHIuYWJvcnQoKTtcbiAgICB0aGlzLnhociA9IG51bGw7XG4gICAgdGhpcy5fc2V0UmVhZHlTdGF0ZSh0aGlzLkNMT1NFRCk7XG4gIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSBTbWFydENvbm5lY3Rpb25zUGx1Z2luOyJdLAogICJtYXBwaW5ncyI6ICI7QUFBQSxJQUFNLFdBQVcsUUFBUSxVQUFVO0FBR25DLElBQU0sbUJBQW1CO0FBQUEsRUFDdkIsU0FBUztBQUFBLEVBQ1QsY0FBYztBQUFBLEVBQ2QsV0FBVztBQUFBLEVBQ1gsaUJBQWlCO0FBQUEsRUFDakIsbUJBQW1CO0FBQUEsRUFDbkIsbUJBQW1CO0FBQUEsRUFDbkIsV0FBVztBQUFBLEVBQ1gsZ0JBQWdCO0FBQUEsRUFDaEIsZUFBZTtBQUFBLEVBQ2YsdUJBQXVCO0FBQUEsRUFDdkIsVUFBVTtBQUFBLEVBQ1YsWUFBWTtBQUFBLEVBQ1osa0JBQWtCO0FBQUEsRUFDbEIsNEJBQTRCO0FBQUEsRUFDNUIsZUFBZTtBQUFBLEVBQ2Ysa0JBQWtCO0FBQUEsRUFDbEIsV0FBVztBQUFBLEVBQ1gsU0FBUztBQUNYO0FBQ0EsSUFBTSwwQkFBMEI7QUFFaEMsSUFBSTtBQUNKLElBQU0sdUJBQXVCLENBQUMsTUFBTSxRQUFRO0FBSTVDLElBQU0sb0JBQW9C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QWlCLEtBQUssSUFBSSxDQUFDO0FBRW5FLFNBQUssSUFBSSxpQkFBaUIsU0FBUyxLQUFLLGVBQWUsS0FBSyxJQUFJLENBQUM7QUFFakUsU0FBSyxJQUFJLEtBQUssS0FBSyxRQUFRLEtBQUssR0FBRztBQUVuQyxhQUFTLFVBQVUsS0FBSyxTQUFTO0FBQy9CLFdBQUssSUFBSSxpQkFBaUIsUUFBUSxLQUFLLFFBQVEsTUFBTSxDQUFDO0FBQUEsSUFDeEQ7QUFFQSxTQUFLLElBQUksa0JBQWtCLEtBQUs7QUFFaEMsU0FBSyxJQUFJLEtBQUssS0FBSyxPQUFPO0FBQUEsRUFDNUI7QUFBQTtBQUFBLEVBRUEsUUFBUTtBQUNOLFFBQUcsS0FBSyxlQUFlLEtBQUssUUFBUTtBQUNsQztBQUFBLElBQ0Y7QUFDQSxTQUFLLElBQUksTUFBTTtBQUNmLFNBQUssTUFBTTtBQUNYLFNBQUssZUFBZSxLQUFLLE1BQU07QUFBQSxFQUNqQztBQUNGO0FBRUEsT0FBTyxVQUFVOyIsCiAgIm5hbWVzIjogWyJsaW5lX2xpbWl0IiwgIml0ZW0iLCAibGluayIsICJmaWxlX2xpbmsiLCAiZmlsZV9saW5rX2xpc3QiXQp9Cg==
