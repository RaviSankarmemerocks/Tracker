const MONACO_CDN = "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs";

const DSAEditor = (() => {
  let helpers = null;
  let monacoReady = null;
  let editor = null;
  let currentProblem = null;
  let saveTimer = null;
  let completionRegistered = false;

  function defaultJavaTemplate(problem) {
    const name = problem.name.replace(/"/g, "'");
    return `import java.util.*;

class Solution {
    /**
     * ${name}
     * Pattern: ${problem.pattern}
     */
    public static void main(String[] args) {
        Solution solution = new Solution();
        // TODO: add sample input and call your method
    }

    // Write your solution below

}
`;
  }

  function setSaveStatus(text, tone = "muted") {
    const el = document.getElementById("editor-save-status");
    if (!el) return;
    el.textContent = text;
    el.dataset.tone = tone;
  }

  function loadMonaco() {
    if (monacoReady) return monacoReady;

    monacoReady = new Promise((resolve, reject) => {
      if (window.monaco) {
        resolve(window.monaco);
        return;
      }

      const script = document.createElement("script");
      script.src = `${MONACO_CDN}/loader.js`;
      script.onload = () => {
        window.require.config({ paths: { vs: MONACO_CDN } });
        window.require(["vs/editor/editor.main"], () => resolve(window.monaco), reject);
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });

    return monacoReady;
  }

  function buildJavaCompletions(monaco) {
    const K = monaco.languages.CompletionItemKind;
    const I = monaco.languages.CompletionItemInsertTextRule;

    const keywordList = [
      "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char", "class",
      "continue", "default", "do", "double", "else", "enum", "extends", "final", "finally",
      "float", "for", "if", "implements", "import", "instanceof", "int", "interface", "long",
      "native", "new", "null", "package", "private", "protected", "public", "return", "short",
      "static", "strictfp", "super", "switch", "synchronized", "this", "throw", "throws",
      "transient", "try", "void", "volatile", "while", "true", "false", "var", "record",
    ];

    const keywords = keywordList.map((label, i) => ({
      label,
      kind: K.Keyword,
      insertText: label,
      detail: "Java keyword",
      sortText: `00${String(i).padStart(3, "0")}`,
      filterText: label,
    }));

    const types = [
      "String", "Integer", "Long", "Double", "Boolean", "Character",
      "List", "ArrayList", "LinkedList", "Map", "HashMap", "TreeMap", "LinkedHashMap",
      "Set", "HashSet", "TreeSet", "Queue", "Deque", "ArrayDeque", "PriorityQueue",
      "Stack", "Vector", "Arrays", "Collections", "Math", "Scanner", "StringBuilder",
      "StringBuffer", "Comparator", "Optional", "Pair", "Object",
    ].map((label) => ({ label, kind: K.Class, insertText: label, detail: "Java type", sortText: `10${label}`, filterText: label }));

    const snippets = [
      {
        label: "ifelse",
        detail: "if / else block",
        insertText: "if (${1:condition}) {\n\t$0\n} else {\n\t\n}",
        kind: K.Snippet,
        insertTextRules: I.InsertAsSnippet,
        sortText: "20ifelse",
        filterText: "ifelse else if",
      },
      {
        label: "switch",
        detail: "switch statement",
        insertText: "switch (${1:value}) {\n\tcase ${2:case1}:\n\t\t$0\n\t\tbreak;\n\tdefault:\n\t\tbreak;\n}",
        kind: K.Snippet,
        insertTextRules: I.InsertAsSnippet,
        sortText: "20switch",
      },
      {
        label: "main",
        detail: "public static void main",
        insertText: "public static void main(String[] args) {\n\t$0\n}",
        kind: K.Snippet,
        insertTextRules: I.InsertAsSnippet,
        sortText: "20main",
        filterText: "main psvm",
      },
      {
        label: "psvm",
        detail: "main shortcut",
        insertText: "public static void main(String[] args) {\n\t$0\n}",
        kind: K.Snippet,
        insertTextRules: I.InsertAsSnippet,
      },
      {
        label: "fori",
        detail: "for loop index",
        insertText: "for (int ${1:i} = 0; ${1:i} < ${2:arr}.length; ${1:i}++) {\n\t$0\n}",
        kind: K.Snippet,
        insertTextRules: I.InsertAsSnippet,
      },
      {
        label: "fore",
        detail: "enhanced for loop",
        insertText: "for (${1:int} ${2:x} : ${3:collection}) {\n\t$0\n}",
        kind: K.Snippet,
        insertTextRules: I.InsertAsSnippet,
      },
      {
        label: "while",
        detail: "while loop block",
        insertText: "while (${1:condition}) {\n\t$0\n}",
        kind: K.Snippet,
        insertTextRules: I.InsertAsSnippet,
        sortText: "20whileloop",
        filterText: "whileloop",
      },
      {
        label: "if",
        detail: "if block snippet",
        insertText: "if (${1:condition}) {\n\t$0\n}",
        kind: K.Snippet,
        insertTextRules: I.InsertAsSnippet,
        sortText: "21if",
        filterText: "ifblock",
      },
      {
        label: "binarysearch",
        detail: "binary search template",
        insertText: [
          "int left = 0, right = ${1:arr}.length - 1;",
          "while (left <= right) {",
          "\tint mid = left + (right - left) / 2;",
          "\tif (${2:arr[mid] == target}) return mid;",
          "\tif (${3:arr[mid] < target}) left = mid + 1;",
          "\telse right = mid - 1;",
          "}",
          "return -1;",
        ].join("\n"),
        kind: K.Snippet,
        insertTextRules: I.InsertAsSnippet,
      },
      {
        label: "twopointer",
        detail: "two pointers template",
        insertText: [
          "int left = 0, right = ${1:arr}.length - 1;",
          "while (left < right) {",
          "\t$0",
          "\t// move left or right based on condition",
          "}",
        ].join("\n"),
        kind: K.Snippet,
        insertTextRules: I.InsertAsSnippet,
      },
      {
        label: "slidingwindow",
        detail: "sliding window template",
        insertText: [
          "int left = 0;",
          "for (int right = 0; right < ${1:arr}.length; right++) {",
          "\t$0",
          "\twhile (${2:windowInvalid}) {",
          "\t\tleft++;",
          "\t}",
          "}",
        ].join("\n"),
        kind: K.Snippet,
        insertTextRules: I.InsertAsSnippet,
      },
      {
        label: "dfs",
        detail: "depth-first search",
        insertText: [
          "private void dfs(${1:int} node) {",
          "\tif (${2:visited[node]}) return;",
          "\tvisited[node] = true;",
          "\t$0",
          "\tfor (${3:int} next : ${4:adj[node]}) {",
          "\t\tdfs(next);",
          "\t}",
          "}",
        ].join("\n"),
        kind: K.Snippet,
        insertTextRules: I.InsertAsSnippet,
      },
      {
        label: "bfs",
        detail: "breadth-first search",
        insertText: [
          "Queue<${1:Integer}> queue = new ArrayDeque<>();",
          "boolean[] visited = new boolean[${2:n}];",
          "queue.offer(${3:start});",
          "visited[${3:start}] = true;",
          "while (!queue.isEmpty()) {",
          "\tint node = queue.poll();",
          "\t$0",
          "\tfor (${4:int} next : ${5:adj[node]}) {",
          "\t\tif (!visited[next]) {",
          "\t\t\tvisited[next] = true;",
          "\t\t\tqueue.offer(next);",
          "\t\t}",
          "\t}",
          "}",
        ].join("\n"),
        kind: K.Snippet,
        insertTextRules: I.InsertAsSnippet,
      },
      {
        label: "dijkstra",
        detail: "shortest path with priority queue",
        insertText: [
          "int[] dist = new int[${1:n}];",
          "Arrays.fill(dist, Integer.MAX_VALUE);",
          "PriorityQueue<int[]> pq = new PriorityQueue<>((a, b) -> a[1] - b[1]);",
          "dist[${2:start}] = 0;",
          "pq.offer(new int[] { ${2:start}, 0 });",
          "while (!pq.isEmpty()) {",
          "\tint[] cur = pq.poll();",
          "\tint node = cur[0], d = cur[1];",
          "\tif (d > dist[node]) continue;",
          "\t$0",
          "}",
        ].join("\n"),
        kind: K.Snippet,
        insertTextRules: I.InsertAsSnippet,
      },
      {
        label: "dp",
        detail: "1D DP template",
        insertText: [
          "int[] dp = new int[${1:n + 1}];",
          "for (int i = 0; i <= ${1:n}; i++) {",
          "\t$0",
          "}",
          "return dp[${1:n}];",
        ].join("\n"),
        kind: K.Snippet,
        insertTextRules: I.InsertAsSnippet,
      },
      {
        label: "listnode",
        detail: "ListNode definition",
        insertText: [
          "static class ListNode {",
          "\tint val;",
          "\tListNode next;",
          "\tListNode(int val) { this.val = val; }",
          "\tListNode(int val, ListNode next) { this.val = val; this.next = next; }",
          "}",
        ].join("\n"),
        kind: K.Snippet,
        insertTextRules: I.InsertAsSnippet,
      },
      {
        label: "treenode",
        detail: "TreeNode definition",
        insertText: [
          "static class TreeNode {",
          "\tint val;",
          "\tTreeNode left, right;",
          "\tTreeNode(int val) { this.val = val; }",
          "\tTreeNode(int val, TreeNode left, TreeNode right) {",
          "\t\tthis.val = val; this.left = left; this.right = right;",
          "\t}",
          "}",
        ].join("\n"),
        kind: K.Snippet,
        insertTextRules: I.InsertAsSnippet,
      },
    ];

    const methods = [
      "Arrays.sort", "Arrays.fill", "Arrays.asList", "Arrays.binarySearch",
      "Collections.sort", "Collections.reverse", "Collections.max", "Collections.min",
      "list.add", "list.get", "list.set", "list.size", "list.remove",
      "map.put", "map.get", "map.getOrDefault", "map.containsKey", "map.keySet", "map.values",
      "set.add", "set.contains", "set.size",
      "queue.offer", "queue.poll", "queue.peek", "queue.isEmpty",
      "stack.push", "stack.pop", "stack.peek",
      "pq.offer", "pq.poll", "pq.peek",
      "sb.append", "sb.toString",
      "Math.max", "Math.min", "Math.abs",
      "str.charAt", "str.length", "str.substring", "str.toCharArray",
    ].map((label, i) => ({
      label: label.split(".").pop(),
      kind: K.Method,
      insertText: `${label.split(".").pop()}($0)`,
      insertTextRules: I.InsertAsSnippet,
      detail: label,
      sortText: `30${String(i).padStart(3, "0")}`,
      filterText: label.replace(".", ""),
    }));

    return [...keywords, ...types, ...snippets, ...methods];
  }

  function filterByPrefix(items, prefix, limit = 12) {
    const q = prefix.toLowerCase();
    let result;
    if (!q) {
      result = items.filter((item) => item.detail === "Java keyword" || item.detail === "Java type");
    } else {
      result = items.filter((item) => {
        const label = String(item.label).toLowerCase();
        const filter = String(item.filterText || item.label).toLowerCase();
        return label.startsWith(q) || filter.startsWith(q);
      });
    }
    return result.slice(0, limit);
  }

  function cursorRange(position) {
    return {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: position.column,
      endColumn: position.column,
    };
  }

  function modifierTypeSuggestions(monaco, position) {
    const K = monaco.languages.CompletionItemKind;
    const range = cursorRange(position);
    return ["void", "int", "long", "double", "float", "boolean", "char", "String"].map((label, i) => ({
      label,
      kind: K.Keyword,
      insertText: ` ${label}`,
      detail: "Return type",
      sortText: `00${String(i).padStart(2, "0")}`,
      range,
    }));
  }

  function accessModifierFollowups(monaco, position) {
    const K = monaco.languages.CompletionItemKind;
    const range = cursorRange(position);
    return ["static", "void", "int", "class"].map((label, i) => ({
      label,
      kind: K.Keyword,
      insertText: ` ${label}`,
      detail: "After access modifier",
      sortText: `00${String(i).padStart(2, "0")}`,
      range,
    }));
  }

  function getLinePrefix(model, position) {
    return model.getValueInRange({
      startLineNumber: position.lineNumber,
      startColumn: 1,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    }).trimEnd();
  }

  function registerEditorTheme(monaco) {
    monaco.editor.defineTheme("dsa-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#171a22",
        "editor.foreground": "#e8ecf4",
        "editorSuggestWidget.background": "#1e2230",
        "editorSuggestWidget.border": "#2a3042",
        "editorSuggestWidget.foreground": "#e8ecf4",
        "editorSuggestWidget.selectedBackground": "#4a62b3",
        "editorSuggestWidget.selectedForeground": "#ffffff",
        "editorSuggestWidget.highlightForeground": "#6c8cff",
        "editorSuggestWidget.focusHighlightForeground": "#ffffff",
      },
    });
  }

  function registerJavaCompletions(monaco) {
    if (completionRegistered) return;
    completionRegistered = true;

    const items = buildJavaCompletions(monaco);
    monaco.languages.registerCompletionItemProvider("java", {
      triggerCharacters: [".", "(", "<"],
      provideCompletionItems(model, position) {
        const word = model.getWordUntilPosition(position);
        const replaceRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        const linePrefix = getLinePrefix(model, position);

        if (/\b(public|private|protected)\s+static\s*$/i.test(linePrefix)) {
          return { suggestions: modifierTypeSuggestions(monaco, position) };
        }

        if (/\b(public|private|protected)\s*$/i.test(linePrefix)) {
          return { suggestions: accessModifierFollowups(monaco, position) };
        }

        const prefix = word.word || "";
        const filtered = filterByPrefix(items, prefix);

        return {
          suggestions: filtered.map((item) => ({
            label: item.label,
            kind: item.kind,
            insertText: item.insertText,
            insertTextRules: item.insertTextRules,
            detail: item.detail,
            sortText: item.sortText,
            filterText: item.filterText,
            range: replaceRange,
          })),
        };
      },
    });
  }

  function editorSuggestOptions() {
    return {
      quickSuggestions: {
        other: "on",
        comments: "off",
        strings: "off",
      },
      quickSuggestionsDelay: 0,
      wordBasedSuggestions: "off",
      suggestOnTriggerCharacters: true,
      acceptSuggestionOnEnter: "on",
      tabCompletion: "on",
      inlineSuggest: { enabled: false },
      snippetSuggestions: "top",
      suggest: {
        showKeywords: true,
        showSnippets: true,
        showClasses: true,
        showMethods: true,
        showWords: false,
        preview: false,
        showInlineDetails: true,
        filterGraceful: true,
        localityBonus: true,
        snippetsPreventQuickSuggestions: false,
      },
    };
  }

  function ensureEditor(monaco) {
    if (editor) return editor;

    registerEditorTheme(monaco);
    monaco.editor.setTheme("dsa-dark");
    registerJavaCompletions(monaco);

    editor = monaco.editor.create(document.getElementById("monaco-container"), {
      value: "",
      language: "java",
      theme: "dsa-dark",
      fontSize: 14,
      lineNumbers: "on",
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 4,
      insertSpaces: true,
      formatOnPaste: true,
      padding: { top: 12, bottom: 12 },
      fixedOverflowWidgets: false,
      ...editorSuggestOptions(),
    });

    editor.onDidChangeModelContent(() => {
      if (!currentProblem || !helpers) return;
      setSaveStatus("Unsaved…", "warn");
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const code = editor.getValue();
        helpers.saveSolution(currentProblem.id, code);
        setSaveStatus("Saved", "success");
      }, 600);
    });

    return editor;
  }

  function getCodeForProblem(problem) {
    const saved = helpers?.getSolution(problem.id);
    if (saved?.code) return saved.code;
    return defaultJavaTemplate(problem);
  }

  async function open(problem) {
    if (!problem || !helpers) return;

    if (currentProblem && currentProblem.id !== problem.id) {
      flushSave();
    }

    document.getElementById("editor-problem-title").textContent = problem.name;
    const overlay = document.getElementById("code-editor-overlay");
    overlay.classList.remove("hidden");
    document.body.classList.add("editor-open");

    currentProblem = problem;
    setSaveStatus("Loading…");

    try {
      const monaco = await loadMonaco();
      registerEditorTheme(monaco);
      monaco.editor.setTheme("dsa-dark");
      const instance = ensureEditor(monaco);
      instance.updateOptions(editorSuggestOptions());
      instance.setValue(getCodeForProblem(problem));
      instance.setPosition({ lineNumber: 1, column: 1 });
      instance.focus();
      setSaveStatus("Saved", "success");
      requestAnimationFrame(() => instance.layout());
    } catch (err) {
      setSaveStatus("Editor failed to load", "error");
      console.error(err);
    }
  }

  function flushSave() {
    if (!currentProblem || !editor || !helpers) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    helpers.saveSolution(currentProblem.id, editor.getValue());
    setSaveStatus("Saved", "success");
  }

  function close() {
    flushSave();
    if (helpers?.onClose) helpers.onClose();
    document.getElementById("code-editor-overlay").classList.add("hidden");
    document.body.classList.remove("editor-open");
    currentProblem = null;
  }

  function resetTemplate() {
    if (!currentProblem || !editor) return;
    const ok = window.confirm("Reset to the default Java template? Your current code will be lost.");
    if (!ok) return;
    helpers.clearSolution(currentProblem.id);
    editor.setValue(defaultJavaTemplate(currentProblem));
    setSaveStatus("Template reset", "success");
  }

  function init(h) {
    helpers = h;

    document.getElementById("editor-close").addEventListener("click", close);
    document.getElementById("editor-reset").addEventListener("click", resetTemplate);
    document.getElementById("code-editor-overlay").addEventListener("click", (e) => {
      if (e.target.id === "code-editor-overlay") close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !document.getElementById("code-editor-overlay").classList.contains("hidden")) {
        close();
      }
    });
  }

  return { init, open, defaultJavaTemplate };
})();

window.DSAEditor = DSAEditor;
