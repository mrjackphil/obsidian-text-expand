import {
    ExpanderQuery,
    formatContent,
    getAllExpandersQuery,
    getClosestQuery,
    getLastLineToReplace
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
import sequences, {Sequences} from "./sequences/sequences";

interface PluginSettings {
    delay: number
    lineEnding: string
    defaultTemplate: string
    excludeCurrent: boolean
    autoExpand: boolean
    prefixes: {
        header: string
        footer: string
    }
}

type NumberTuple = [number, number]

export interface SearchDetails {
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
        delay: 300,
        excludeCurrent: true,
        lineEnding: '<-->',
        prefixes: {
            header: '^',
            footer: '>'
        }
    }

    seqs: Sequences[] = sequences

    constructor(app: App, plugin: PluginManifest) {
        super(app, plugin);

        this.search = this.search.bind(this)
        this.init = this.init.bind(this)
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
            tab: this.getSearchTabIndex()
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

    getSearchTabIndex(): number {
        let leftTabs = this.app.workspace.leftSplit.children[0].children;
        let searchTabId: string;
        this.app.workspace.iterateAllLeaves((leaf: any) => {
            if (leaf.getViewState().type == "search") { searchTabId = leaf.id; }
        });
        return leftTabs.findIndex((item: any, index: number, array: any[]) => {
            if (item.id == searchTabId) { return true; }
        });
    };

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

    async startTemplateMode(query: ExpanderQuery, lastLine: number, prefixes: PluginSettings["prefixes"]) {
        const currentView = this.app.workspace.activeLeaf.view
        let currentFileName = ''

        const templateContent = query.template.split('\n')

        const isHeader = (line: string) => line.startsWith(prefixes.header)
        const isFooter = (line: string) => line.startsWith(prefixes.footer)
        const isRepeat = (line: string) => !isHeader(line) && !isFooter(line)

        const heading = templateContent.filter(isHeader).map((s) => s.slice(1))
        const footer = templateContent.filter(isFooter).map((s) => s.slice(1))
        const repeatableContent =
            templateContent.filter(isRepeat).filter(e => e).length === 0
                ? [this.config.defaultTemplate]
                : templateContent.filter(isRepeat).filter(e => e)

        if (currentView instanceof FileView) {
            currentFileName = currentView.file.basename
        }

        const searchResults = await this.getFoundAfterDelay()
        const files = Array.from(searchResults.keys())

        const filterFiles = this.config.excludeCurrent
            ? files.filter(file => file.basename !== currentFileName)
            : files

        const format = async (r: TFile, template: string, index: number) => {
            const fileContent = (new RegExp(this.seqs.filter(e => e.readContent).map(e => e.name).join('|')).test(template))
                ? await this.app.vault.cachedRead(r)
                : ''

            return this.seqs.reduce((acc, seq) =>
                acc.replace(new RegExp(seq.name, 'gu'), replace => seq.format(this, replace, fileContent, r, searchResults.get(r), index)), template)
        }

        const changed = await Promise.all(
            filterFiles
                .map(async (file, i) => {
                    const result = await Promise.all(repeatableContent.map(async (s) => await format(file, s, i)))
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

        const viewBeforeReplace = this.app.workspace.activeLeaf.view
        if (viewBeforeReplace instanceof MarkdownView) {
            if (viewBeforeReplace.file.basename !== currentFileName) {
                return
            }
        } else {
            return
        }

        this.cm.replaceRange(result,
            {line: query.end + 1, ch: 0},
            {line: lastLine, ch: this.cm.getLine(lastLine)?.length || 0})

        return Promise.resolve()
    }

    async runQuery(query: ExpanderQuery, content: string[]) {
        const { lineEnding, prefixes } = this.config

        if (!query) {
            new Notification('Expand query not found')
            return Promise.resolve()
        }

        const lastLine = getLastLineToReplace(content, query, this.config.lineEnding)
        this.cm.replaceRange('\n' + lineEnding,
            {line: query.end + 1, ch: 0},
            {line: lastLine, ch: this.cm.getLine(lastLine)?.length || 0})

        const newContent = formatContent(this.cm.getValue())

        this.search(query.query)
        return await this.startTemplateMode(query, getLastLineToReplace(newContent, query, this.config.lineEnding), prefixes)
    }

    init(proceedAllQueriesOnPage = false) {
        const currentView = this.app.workspace.activeLeaf.view
        const isInEditableView = currentView instanceof MarkdownView

        // Is on editable view
        if (!isInEditableView) {
            return
        }

        const cmDoc = this.cm = currentView.sourceMode.cmEditor
        const curNum = cmDoc.getCursor().line
        const content = cmDoc.getValue()

        const formatted = formatContent(content)
        let findQueries = getAllExpandersQuery(formatted)
        const closestQuery = getClosestQuery(findQueries, curNum)

        if (proceedAllQueriesOnPage) {
            findQueries.reduce((promise, query, i) =>
                promise.then(() => {
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
            callback: this.init,
            hotkeys: []
        })

        this.addCommand({
            id: 'editor-expand-all',
            name: 'expand all',
            callback: () => this.init(true),
            hotkeys: []
        })

        this.app.workspace.on('file-open', async () => {
            if (!this.config.autoExpand) {
                return
            }

            const activeLeaf = this.app.workspace.activeLeaf
            if (!activeLeaf) {
                return
            }

            const activeView = activeLeaf.view
            const isAllowedView = activeView instanceof MarkdownView
            if (!isAllowedView) {
                return
            }

            this.init(true)

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
                slider.setLimits(100, 10000, 100)
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
            .setHeading()
            .setName('Prefixes')

        new Setting(containerEl)
            .setName('Header')
            .setDesc('Line prefixed by this symbol will be recognized as header')
            .addText(text => {
                text.setValue(this.plugin.config.prefixes.header)
                    .onChange(val => {
                        this.plugin.config.prefixes.header = val
                        this.plugin.saveSettings()
                    })
            })

        new Setting(containerEl)
            .setName('Footer')
            .setDesc('Line prefixed by this symbol will be recognized as footer')
            .addText(text => {
                text.setValue(this.plugin.config.prefixes.footer)
                    .onChange(val => {
                        this.plugin.config.prefixes.footer = val
                        this.plugin.saveSettings()
                    })
            })

        new Setting(containerEl)
            .setName('Sequences')
            .setDesc('REGEXP - DESCRIPTION')
            .setDesc(
                (() => {
                    const fragment = new DocumentFragment()
                    const div = fragment.createEl('div')
                    this.plugin.seqs
                        .map(e => e.name + ' - ' + (e.desc || ''))
                        .map(e => {
                            const el = fragment.createEl('div')
                            el.setText(e)
                            el.setAttribute('style', `
                                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                                margin-bottom: 0.5rem;
                                padding-bottom: 0.5rem;
                            `)
                            return el
                        }).forEach(el => {
                        div.appendChild(el)
                    })
                    fragment.appendChild(div)

                    return fragment
                })()
            )
    }
}
