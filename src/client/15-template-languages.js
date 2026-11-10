/**
 * 15-template-languages：补 Monaco 自带的 HTML 模板语法。
 *
 * Monaco 已内置 handlebars / twig / liquid / pug / razor / freemarker2；这里补上
 * 市面上常用但 Monaco 没带的：EJS、Eta、ERB、Nunjucks/Jinja2（共用一套）、
 * Blade、Haml、Slim。均为「HTML + 模板分隔符里的代码」的简化 Monarch 高亮，
 * 不追求语法服务，只保证打开文件时有正常的颜色、注释和括号行为。
 */
G.registerTemplateLanguages = function registerTemplateLanguages(monaco) {
  if (monaco === null || monaco === undefined || !monaco.languages || G.__templateLanguagesRegistered === true) return
  G.__templateLanguagesRegistered = true

  const existing = (() => {
    try {
      const list = monaco.languages.getLanguages()
      return new Set(Array.isArray(list) ? list.map((item) => item.id) : [])
    } catch {
      return new Set()
    }
  })()

  const define = (id, extensions, aliases, tokenizer, configuration) => {
    if (existing.has(id)) return
    try {
      monaco.languages.register({ id, extensions, aliases })
      if (tokenizer !== null && tokenizer !== undefined) monaco.languages.setMonarchTokensProvider(id, tokenizer)
      if (configuration !== null && configuration !== undefined) monaco.languages.setLanguageConfiguration(id, configuration)
      existing.add(id)
    } catch (error) {
      /* 某个语言注册失败不影响其它语言 */
    }
  }

  const htmlBase = () => ({
    root: [
      [/<!--/, 'comment', '@htmlComment'],
      [/<[a-zA-Z][\w:-]*/, { token: 'tag', next: '@htmlTag' }],
      [/<\/[a-zA-Z][\w:-]*/, { token: 'tag', next: '@htmlTag' }],
      [/&[a-zA-Z#0-9]+;/, 'string.escape'],
      [/[^<&]+/, ''],
    ],
    htmlComment: [
      [/-->/, { token: 'comment', next: '@pop' }],
      [/./, 'comment'],
    ],
    htmlTag: [
      [/\s+/, ''],
      [/[a-zA-Z_:][\w:.-]*/, 'attribute.name'],
      [/=/, 'delimiter'],
      [/"[^"]*"/, 'attribute.value'],
    /* ' 不参与转义（Monarch 不需要） */
      [/'[^']*'/, 'attribute.value'],
      [/\/>/, { token: 'tag', next: '@pop' }],
      [/>/, { token: 'tag', next: '@pop' }],
      [/</, { token: 'tag', next: '@pop' }],
    ],
  })

  const jsKeywords = 'if|else|for|while|do|switch|case|break|continue|function|return|var|let|const|new|typeof|instanceof|in|of|try|catch|finally|throw|class|extends|super|import|export|from|as|await|async|yield|this|true|false|null|undefined|delete|void|with|debugger'
  const jinjaKeywords = 'if|else|elif|endif|for|endfor|block|endblock|extends|include|import|from|as|set|endset|macro|endmacro|filter|endfilter|with|endwith|raw|endraw|call|endcall|is|not|and|or|in|recursive|without|context|autoescape|endautoescape|trans|endtrans|do|loop|else'
  const rubyKeywords = 'def|end|if|elsif|else|unless|case|when|while|until|for|do|begin|rescue|ensure|class|module|return|yield|break|next|redo|retry|super|self|nil|true|false|and|or|not|require|include|extend|attr_accessor|attr_reader|attr_writer|lambda|proc|puts|print|raise|new'
  const bladeKeywords = 'if|elseif|else|endif|unless|endunless|foreach|endforeach|forelse|endforelse|for|endfor|while|endwhile|switch|endswitch|case|break|continue|extends|section|endsection|yield|include|each|push|stack|component|slot|php|endphp|auth|guest|env|production|error|csrf|method|json|checked|selected|disabled|readonly|required'

  const codeTokens = (keywords, closePatterns) => {
    const rules = []
    for (const close of closePatterns) rules.push(close)
    rules.push(
      [/\/\/.*$/, 'comment'],
      [/\/\*/, 'comment', '@blockComment'],
      [/"[^"]*"/, 'string'],
      [/'[^']*'/, 'string'],
      [/`[^`]*`/, 'string'],
      [new RegExp(`\\b(?:${keywords})\\b`), 'keyword'],
      [/\b\d+(?:\.\d+)?\b/, 'number'],
      [/[A-Za-z_$][\w$]*/, 'identifier'],
      [/[{}()\[\]]/, '@brackets'],
      [/[<>=!+\-*/%&|^~?:;,.]+/, 'operator'],
      [/\s+/, ''],
    )
    return rules
  }

  const blockCommentState = [
    [/\*\//, { token: 'comment', next: '@pop' }],
    [/./, 'comment'],
  ]

  /* ── EJS / Eta：HTML + <% ... %> ───────────────────────────────────── */
  define('ejs', ['.ejs', '.eta'], ['EJS', 'Eta'], (() => {
    const base = htmlBase()
    return {
      defaultToken: '',
      tokenizer: {
        root: [
          [/<!--/, 'comment', '@htmlComment'],
          [/<%#/, 'comment', '@ejsComment'],
          [/<%[-=]?/, { token: 'delimiter.template', next: '@ejsCode' }],
          ...base.root.slice(1),
        ],
        htmlComment: base.htmlComment,
        htmlTag: base.htmlTag,
        ejsComment: [
          [/%>/, { token: 'comment', next: '@pop' }],
          [/./, 'comment'],
        ],
        ejsCode: codeTokens(jsKeywords, [[/%>/, { token: 'delimiter.template', next: '@pop' }]]),
        blockComment: blockCommentState,
      },
    }
  })(), {
    comments: { blockComment: ['<!--', '-->'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' },
      { open: '<%', close: '%>' }, { open: '<%=', close: '%>' },
      { open: '"', close: '"' }, { open: "'", close: "'" },
    ],
    surroundingPairs: [{ open: '<%', close: '%>' }, { open: '"', close: '"' }, { open: "'", close: "'" }],
  })

  /* ── ERB：HTML + <% ... %>（Ruby 代码） ────────────────────────────── */
  define('erb', ['.erb', '.rhtml', '.html.erb'], ['ERB'], (() => {
    const base = htmlBase()
    return {
      defaultToken: '',
      tokenizer: {
        root: [
          [/<!--/, 'comment', '@htmlComment'],
          [/<%#/, 'comment', '@erbComment'],
          [/<%[-=]?/, { token: 'delimiter.template', next: '@erbCode' }],
          ...base.root.slice(1),
        ],
        htmlComment: base.htmlComment,
        htmlTag: base.htmlTag,
        erbComment: [
          [/%>/, { token: 'comment', next: '@pop' }],
          [/./, 'comment'],
        ],
        erbCode: codeTokens(rubyKeywords, [[/%>/, { token: 'delimiter.template', next: '@pop' }]]),
        blockComment: blockCommentState,
      },
    }
  })(), {
    comments: { blockComment: ['<!--', '-->'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' },
      { open: '<%', close: '%>' }, { open: '"', close: '"' }, { open: "'", close: "'" },
    ],
  })

  /* ── Nunjucks / Jinja2：HTML + {{ }} / {% %} / {# #} ─────────────── */
  define('jinja', ['.njk', '.nunjucks', '.jinja', '.jinja2', '.j2', '.j2.html'], ['Nunjucks', 'Jinja2'], {
    defaultToken: '',
    tokenizer: {
      root: [
        [/<!--/, 'comment', '@htmlComment'],
        [/\{#/, 'comment', '@jinjaComment'],
        [/\{\{/, { token: 'delimiter.template', next: '@jinjaExpr' }],
        [/\{%/, { token: 'delimiter.template', next: '@jinjaStmt' }],
        [/<[a-zA-Z][\w:-]*/, { token: 'tag', next: '@htmlTag' }],
        [/<\/[a-zA-Z][\w:-]*/, { token: 'tag', next: '@htmlTag' }],
        [/&[a-zA-Z#0-9]+;/, 'string.escape'],
        [/[^<{&]+/, ''],
      ],
      htmlComment: [[/-->/, { token: 'comment', next: '@pop' }], [/./, 'comment']],
      htmlTag: htmlBase().htmlTag,
      jinjaComment: [[/#\}/, { token: 'comment', next: '@pop' }], [/./, 'comment']],
      jinjaExpr: codeTokens(jinjaKeywords, [
        [/\}\}/, { token: 'delimiter.template', next: '@pop' }],
        [/\|/, 'operator'],
      ]),
      jinjaStmt: codeTokens(jinjaKeywords, [
        [/%\}/, { token: 'delimiter.template', next: '@pop' }],
        [/\|/, 'operator'],
      ]),
      blockComment: blockCommentState,
    },
  }, {
    comments: { blockComment: ['<!--', '-->'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' },
      { open: '{{', close: '}}' }, { open: '{%', close: '%}' }, { open: '{#', close: '#}' },
      { open: '"', close: '"' }, { open: "'", close: "'" },
    ],
  })

  /* ── Blade：HTML + {{ }} / {!! !!} / {{-- --}} / @directive ─────── */
  define('blade', ['.blade.php'], ['Blade'], (() => {
    const base = htmlBase()
    return {
      defaultToken: '',
      tokenizer: {
        root: [
          [/\{\{--/, 'comment', '@bladeComment'],
          [/\{!!/, { token: 'delimiter.template', next: '@bladeExpr' }],
          [/\{\{/, { token: 'delimiter.template', next: '@bladeExpr' }],
          [/@[a-zA-Z_][\w-]*/, 'keyword.directive'],
          ...base.root,
        ],
        htmlComment: base.htmlComment,
        htmlTag: base.htmlTag,
        bladeComment: [[/--\}\}/, { token: 'comment', next: '@pop' }], [/./, 'comment']],
        bladeExpr: codeTokens(bladeKeywords, [
          [/\}\}/, { token: 'delimiter.template', next: '@pop' }],
          [/!!\}/, { token: 'delimiter.template', next: '@pop' }],
        ]),
        blockComment: blockCommentState,
      },
    }
  })(), {
    comments: { blockComment: ['{{--', '--}}'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' },
      { open: '{{', close: '}}' }, { open: '{{--', close: '--}}' },
      { open: '"', close: '"' }, { open: "'", close: "'" },
    ],
  })

  /* ── Haml：缩进 + %tag / .class / #id / = / - ──────────────────── */
  define('haml', ['.haml'], ['Haml'], {
    defaultToken: '',
    tokenizer: {
      root: [
        [/^\s*!!!.*$/, 'meta'],
        [/^\s*\/.*$/, 'comment'],
        [/^\s*%[a-zA-Z][\w:-]*/, 'tag'],
        [/[.#][\w-]+/, 'attribute.name'],
        [/^\s*[-=]/, 'operator'],
        [/\{.*?\}/, 'string.interpolated'],
        [/"[^"]*"/, 'string'],
        [/'[^']*'/, 'string'],
        [/[A-Za-z_][\w-]*:/, 'attribute.name'],
        [/[^\n]+/, ''],
        [/\n/, ''],
      ],
    },
  }, {
    comments: { lineComment: '/' },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
  })

  /* ── Slim：缩进 + tag / = / - / | ──────────────────────────────── */
  define('slim', ['.slim'], ['Slim'], {
    defaultToken: '',
    tokenizer: {
      root: [
        [/^\s*(doctype)\b/, 'keyword'],
        [/^\s*\/.*$/, 'comment'],
        [/^\s*[-=]/, 'operator'],
        [/^\s*\|/, 'string'],
        [/^[\s]*[a-zA-Z][\w-]*/, 'tag'],
        [/[.#][\w-]+/, 'attribute.name'],
        [/[a-zA-Z_][\w-]*=/, 'attribute.name'],
        [/"[^"]*"/, 'string'],
        [/'[^']*'/, 'string'],
        [/[^\n]+/, ''],
        [/\n/, ''],
      ],
    },
  }, {
    comments: { lineComment: '/' },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
  })
}
