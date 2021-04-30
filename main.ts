import {
    ExpanderQuery,
    formatContent,
    getAllExpandersQuery,
    getClosestQuery,
    getLastLineToReplace,
    trimContent
} from 'helpers';
import {
    App,
    Plugin,
    PluginSettingTab,
    Setting,
    TFile,
    FileView,
    MarkdownView,
    PluginManifest
} from 'obsidian';
import CodeMirror from 'codemirror'

interface PluginSettings {
    delay: number
    lineEnding: string
    defaultTemplate: string
    excludeCurrent: boolean
    autoExpand: boolean
}

interface Sequences {
    loop: boolean
    name: string
    format: (s: string, content: string, file: TFile, results?: SearchDetails) => string
    desc: string
    readContent?: boolean
    usingSearch?: boolean
}

type NumberTuple = [number, number]

interface SearchDetails {
    app: App
    children: any[]
    childrenEl: HTMLElement
    collapseEl: HTMLElement
    collapsed: boolean
    collapsible: boolean
    containerEl: HTMLElement
    content: string
    dom: any
    el: HTMLElement
    extraContext: () => boolean
    file: TFile
    info: any
    onMatchRender: any
    pusherEl: HTMLElement
    result: {
        filename?: NumberTuple[]
        content?: NumberTuple[]
    }
}

export default class TextExpander extends Plugin {
    cm: CodeMirror.Editor

    config: PluginSettings = {
        autoExpand: false,
        defaultTemplate: '- $link',
        delay: 2000,
        excludeCurrent: true,
        lineEnding: '<--->'
    }

    seqs: Sequences[] = [
        {name: '\\$filename', loop: true, format: (_s: string, _content: string, file: TFile) => file.basename, desc: 'name of the founded file'},
        {name: '\\$link', loop: true, format: (_s: string, _content: string, file: TFile) => this.app.fileManager.generateMarkdownLink(file, file.path), desc: 'link based on Obsidian settings'},
        {
            name: '\\$lines:\\d+', loop: true, readContent: true, format: (s: string, content: string, _file: TFile) => {
                const digits = Number(s.split(':')[1])

                return trimContent(content)
                    .split('\n')
                    .filter((_: string, i: number) => i < digits)
                    .join('\n')
                    .replace(new RegExp(this.config.lineEnding, 'g'), '')
            },
            desc: 'specified count of lines from the found file'
        },
        {
            name: '\\$frontmatter:[a-zA-Z0-9_-]+',
            loop: true,
            format: (s: string, _content: string, file: TFile) => this.getFrontMatter(s, file),
            desc: 'value from the frontmatter key in the found file'
        },
        {
            name: '\\$lines+',
            loop: true,
            readContent: true,
            format: (s: string, content: string, _file: TFile) => content.replace(new RegExp(this.config.lineEnding, 'g'), ''),
            desc: 'all content from the found file'
        },
        {name: '\\$ext', loop: true, format: (s: string, content: string, file: TFile) => file.extension, desc: 'return file extension'},
        {name: '\\$created', loop: true, format: (s: string, content: string, file: TFile) => String(file.stat.ctime), desc: 'created time'},
        {name: '\\$size', loop: true, format: (s: string, content: string, file: TFile) => String(file.stat.size), desc: 'size of the file'},
        {name: '\\$path', loop: true, format: (s: string, content: string, file: TFile) => file.path, desc: 'path to the found file'},
        {name: '\\$parent', loop: true, format: (s: string, content: string, file: TFile) => file.parent.name, desc: 'parent folder name'},
        {
            name: '^(.+|)\\$header:.+',
            loop: true,
            format: (s: string, content: string, file: TFile) => {
                const prefix = s.slice(0, s.indexOf('$'))
                const header = s.slice(s.indexOf('$')).replace('$header:', '').replace(/"/g, '')
                const neededLevel = header.split("#").length - 1
                const neededTitle = header.replace(/^#+/g, '').trim()

                const metadata = this.app.metadataCache.getFileCache(file)

                return metadata.headings?.filter(e => {
                    const tests = [
                        [neededTitle, e.heading.includes(neededTitle)],
                        [neededLevel, e.level === neededLevel]
                    ].filter(e => e[0])

                    if (tests.length) {
                        return tests.map(e => e[1]).every(e => e === true)
                    }

                    return true
                })
                    .map(h => this.app.fileManager.generateMarkdownLink(file, file.path, '#' + h.heading))
                    .map(link => prefix + link)
                    .join('\n') || ''

            },
            desc: 'headings from founded files. $header:## - return all level 2 headings. $header:Title - return all heading which match the string. Can be prepended like: - !$header:## to transclude the headings.'
        },
        {
            name: '^(.+|)\\$blocks',
            readContent: true,
            loop: true,
            format: (s: string, content: string, file: TFile) => {
                return content
                    .split('\n')
                    .filter(e => /\^\w+$/.test(e))
                    .map(e => s
                        .replace(
                            '$blocks',
                            `(${encodeURIComponent(file.basename)}#${e.replace(/^.+?(\^\w+$)/, '$1')})`
                        ))
                    .join('\n')
            },
            desc: 'block ids from the found files. Can be prepended.'
        },
        {name: '^(.+|)\\$match', loop: true, format: (s: string, content: string, file: TFile, results) => {

            const prefix = s.slice(0, s.indexOf('$'))
            return results.result.content?.map(t => results.content.slice(...t)).map(t => prefix + t).join('\n')
            }, desc: 'extract found selections'},
    ]

    constructor(app: App, plugin: PluginManifest) {
        super(app, plugin);

        this.search = this.search.bind(this)
        this.initExpander = this.initExpander.bind(this)
        this.reformatLinks = this.reformatLinks.bind(this)
    }

    getFrontMatter(s: string, r: TFile) {
        const {frontmatter = null} = this.app.metadataCache.getCache(r.path)

        if (frontmatter) {
            return frontmatter[s.split(':')[1]] || '';
        }

        return ''
    }

    reformatLinks(links: TFile[], mapFunc = (s: string) => '[[' + s + ']]') {
        const currentView = this.app.workspace.activeLeaf.view

        if (currentView instanceof FileView) {
            return links?.map(e => e.basename)
                .filter(e => currentView.file.basename !== e)
                ?.map(mapFunc)?.join('\n')
        }

        return links?.map(e => e.basename)?.map(mapFunc)?.join('\n')
    }

    search(s: string) {
        // @ts-ignore
        const globalSearchFn = this.app.internalPlugins.getPluginById('global-search').instance.openGlobalSearch.bind(this)
        const search = (query: string) => globalSearchFn(query)

        const leftSplitState = {
            // @ts-ignore
            collapsed: this.app.workspace.leftSplit.collapsed,
            // @ts-ignore
            tab: this.app.workspace.leftSplit.children[0].currentTab
        }

        search(s)
        if (leftSplitState.collapsed) {
            // @ts-ignore
            this.app.workspace.leftSplit.collapse()
        }

        // @ts-ignore
        if (leftSplitState.tab !== this.app.workspace.leftSplit.children[0].currentTab) {
            // @ts-ignore
            this.app.workspace.leftSplit.children[0].selectTabIndex(leftSplitState.tab)
        }
    }

    async getFoundAfterDelay(): Promise<Map<TFile, SearchDetails>> {
        const searchLeaf = this.app.workspace.getLeavesOfType('search')[0]
        const view = await searchLeaf.open(searchLeaf.view)
        return new Promise(resolve => {
            setTimeout(() => {
                // @ts-ignore
                const results = view.dom.resultDomLookup as Map<TFile, SearchDetails>

                return resolve(results)
            }, this.config.delay)
        })
    }

    async startTemplateMode(query: ExpanderQuery, lastLine: number) {
        const currentView = this.app.workspace.activeLeaf.view
        let currentFileName = ''

        const templateContent = query.template.split('\n')

        const heading = templateContent.filter(e => e[0] === '^').map((s) => s.slice(1))
        const footer = templateContent.filter(e => e[0] === '>').map((s) => s.slice(1))
        const repeatableContent =
            templateContent.filter(e => e[0] !== '^' && e[0] !== '>').filter(e => e).length === 0
                ? [this.config.defaultTemplate]
                : templateContent.filter(e => e[0] !== '^' && e[0] !== '>').filter(e => e)

        if (currentView instanceof FileView) {
            currentFileName = currentView.file.basename
        }

        const searchResults = await this.getFoundAfterDelay()
        const files = Array.from(searchResults.keys())

        const filterFiles = this.config.excludeCurrent
            ? files.filter(file => file.basename !== currentFileName)
            : files

        const format = async (r: TFile, template: string) => {
            const fileContent = (new RegExp(this.seqs.filter(e => e.readContent).map(e => e.name).join('|')).test(template))
                ? await this.app.vault.cachedRead(r)
                : ''

            const results = (new RegExp(this.seqs.filter(e => e.usingSearch).map(e => e.name).join('|')).test(template))
                ? searchResults.get(r)
                : undefined

            return this.seqs.reduce((acc, seq) =>
                acc.replace(new RegExp(seq.name, 'g'), replace => seq.format(replace, fileContent, r, results)), template)
        }

        const changed = await Promise.all(
            filterFiles
                .map(async (file) => {
                    const result = await Promise.all(repeatableContent.map(async (s) => await format(file, s)))
                    return result.join('\n')
                })
        )

        const result = [
            ' ',
            heading.join('\n'),
            changed.join('\n'),
            footer.join('\n'),
            ' ',
            this.config.lineEnding
        ].filter(e => e).join('\n')

        this.cm.replaceRange(result,
            {line: query.end + 1, ch: 0},
            {line: lastLine, ch: this.cm.getLine(lastLine)?.length || 0})

        return Promise.resolve()
    }

    async runQuery(query: ExpanderQuery, content: string[]) {
        if (!query) {
            new Notification('Expand query not found')
            return Promise.resolve()
        }
        const lastLine = getLastLineToReplace(content, query, this.config.lineEnding)
        this.cm.replaceRange(this.config.lineEnding,
            {line: query.end + 1, ch: 0},
            {line: lastLine, ch: this.cm.getLine(lastLine)?.length || 0})

        const newContent = formatContent(this.cm.getValue())

        this.search(query.query)
        return await this.startTemplateMode(query, getLastLineToReplace(newContent, query, this.config.lineEnding))
    }

    initExpander(all = false) {
        const currentView = this.app.workspace.activeLeaf.view

        if (!(currentView instanceof MarkdownView)) {
            return
        }

        const cmDoc = this.cm = currentView.sourceMode.cmEditor
        const curNum = cmDoc.getCursor().line
        const content = cmDoc.getValue()

        const formatted = formatContent(content)
        let findQueries = getAllExpandersQuery(formatted)
        const closestQuery = getClosestQuery(findQueries, curNum)

        if (all) {
            findQueries.reduce((promise, query, i) =>
                promise.then( () => {
                    const newContent = formatContent(cmDoc.getValue())
                    const updatedQueries = getAllExpandersQuery(newContent)

                    return this.runQuery(updatedQueries[i], newContent)
                }), Promise.resolve()
            )
        } else {
            this.runQuery(closestQuery, formatted)
        }
    }

    async onload() {
        this.addSettingTab(new SettingTab(this.app, this));

        this.addCommand({
            id: 'editor-expand',
            name: 'expand',
            callback: this.initExpander,
            hotkeys: []
        })

        this.addCommand({
            id: 'editor-expand-all',
            name: 'expand all',
            callback: () => this.initExpander(true),
            hotkeys: []
        })

        this.app.workspace.on('file-open', async () => {
            if (!this.config.autoExpand) { return }

            const activeLeaf = this.app.workspace.activeLeaf
            if (!activeLeaf) { return }

            const activeView = activeLeaf.view
            const isAllowedView = activeView instanceof MarkdownView
            if (!isAllowedView) { return }

            this.initExpander(true)

        })

        const data = await this.loadData() as PluginSettings
        if (data) {
            this.config = {
                ...this.config,
                ...data
            }
        }
    }

    onunload() {
        console.log('unloading plugin');
    }

    saveSettings() {
        this.saveData(this.config)
    }
}

class SettingTab extends PluginSettingTab {
    plugin: TextExpander

    constructor(app: App, plugin: TextExpander) {
        super(app, plugin);

        this.app = app
        this.plugin = plugin
    }

    display(): void {
        let {containerEl} = this;

        containerEl.empty();

        containerEl.createEl('h2', {text: 'Settings for Text Expander'});

        new Setting(containerEl)
            .setName('Auto Expand')
            .setDesc('Expand all queries in a file once you open it')
            .addToggle(toggle => {
                toggle
                    .setValue(this.plugin.config.autoExpand)
                    .onChange(value => {
                        this.plugin.config.autoExpand = value
                        this.plugin.saveSettings()
                    })
            })

        new Setting(containerEl)
            .setName('Delay')
            .setDesc('Text expander don\' wait until search completed. It waits for a delay and paste result after that.')
            .addSlider(slider => {
                slider.setLimits(1000, 10000, 1000)
                slider.setValue(this.plugin.config.delay)
                slider.onChange(value => {
                    this.plugin.config.delay = value
                    this.plugin.saveSettings()
                })
                slider.setDynamicTooltip()
            })

        new Setting(containerEl)
            .setName('Line ending')
            .setDesc('You can specify the text which will appear at the bottom of the generated text.')
            .addText(text => {
                text.setValue(this.plugin.config.lineEnding)
                    .onChange(val => {
                        this.plugin.config.lineEnding = val
                        this.plugin.saveSettings()
                    })
            })

        new Setting(containerEl)
            .setName('Default template')
            .setDesc('You can specify default template')
            .addText(text => {
                text.setValue(this.plugin.config.defaultTemplate)
                    .onChange(val => {
                        this.plugin.config.defaultTemplate = val
                        this.plugin.saveSettings()
                    })
            })

        new Setting(containerEl)
            .setName('Exclude current file')
            .setDesc('You can specify should text expander exclude results from current file or not')
            .addToggle(toggle => {
                toggle
                    .setValue(this.plugin.config.excludeCurrent)
                    .onChange(value => {
                        this.plugin.config.excludeCurrent = value
                        this.plugin.saveSettings()
                    })
            })

        new Setting(containerEl)
            .setName('Sequences')
            .setDesc(
                (() => {
                    const fragment = new DocumentFragment()
                    const pre = fragment.createEl('pre')
                    pre.innerText = this.plugin.seqs
                        .map(e =>
                            e.name.replace('\\', '') + ': ' + (e.desc || '')
                        ).join('\n')
                    fragment.appendChild(pre)

                    return fragment
                })()
            )
    }
}
