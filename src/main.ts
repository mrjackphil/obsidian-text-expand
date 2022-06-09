import {
    ExpanderQuery,
    getAllExpandersQuery,
    getClosestQuery,
    getLastLineToReplace
} from 'src/helpers/helpers';
import {
    App, Editor,
    FileView,
    MarkdownView,
    Plugin,
    PluginManifest,
    PluginSettingTab,
    Setting,
    TFile
} from 'obsidian';
import sequences, {Sequences} from "./sequences/sequences";
import {splitByLines} from "./helpers/string";
import {extractFilesFromSearchResults} from "./helpers/search-results";
import {render} from "eta";
import {getFileInfo} from "./helpers/tfile";

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
    cm: Editor

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

            await this.init(true)

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

    async saveSettings() {
        await this.saveData(this.config)
    }

    private async init(proceedAllQueriesOnPage = false) {
        const currentView = this.app.workspace.activeLeaf.view

        // Is on editable view
        if (!(currentView instanceof MarkdownView)) {
            return
        }

        const cmDoc: Editor = this.cm = currentView.editor

        const curNum = cmDoc.getCursor().line
        const content = cmDoc.getValue()

        const formatted = splitByLines(content)
        let findQueries = getAllExpandersQuery(formatted)
        const closestQuery = getClosestQuery(findQueries, curNum)

        if (proceedAllQueriesOnPage) {
            await findQueries.reduce((promise, query, i) =>
                promise.then(() => {
                    const newContent = splitByLines(cmDoc.getValue())
                    const updatedQueries = getAllExpandersQuery(newContent)

                    return this.runExpanderCodeBlock(updatedQueries[i], newContent)
                }), Promise.resolve()
            )
        } else {
            await this.runExpanderCodeBlock(closestQuery, formatted)
        }
    }

    private async runExpanderCodeBlock(query: ExpanderQuery, content: string[]) {
        const {lineEnding, prefixes} = this.config

        if (!query) {
            new Notification('Expand query not found')
            return Promise.resolve()
        }

        this.clearOldResultsInFile(content, query, lineEnding);

        const newContent = splitByLines(this.cm.getValue());

        this.search(query.query)
        return await this.runTemplateProcessing(query, getLastLineToReplace(newContent, query, this.config.lineEnding), prefixes)
    }

    private async runTemplateProcessing(query: ExpanderQuery, lastLine: number, prefixes: PluginSettings["prefixes"]) {
        const currentView = this.app.workspace.activeLeaf.view
        let currentFileName = ''

        const templateContent = query.template.split('\n')

        const {heading, footer, repeatableContent} = this.parseTemplate(prefixes, templateContent);

        if (currentView instanceof FileView) {
            currentFileName = currentView.file.basename
        }

        const searchResults = await this.getFoundAfterDelay()

        const files = extractFilesFromSearchResults(searchResults, currentFileName, this.config.excludeCurrent);

        const currentFileInfo: {} = (currentView instanceof FileView)
            ? await getFileInfo(this, currentView.file)
            : {}
        const filesInfo = await Promise.all(
            files.map(file => getFileInfo(this, file))
        )

        let changed;

        if (query.template.contains("<%")) {
            const templateToRender = repeatableContent.join('\n')
            const dataToRender = {
                current: currentFileInfo,
                files: filesInfo
            }

            changed = await render(templateToRender, dataToRender, {autoEscape: false})
            // changed = doT.template(templateToRender, {strip: false})(dataToRender)
        } else {
            changed = await this.generateTemplateFromSequences(files, repeatableContent, searchResults);
        }

        let result = [
            heading,
            changed,
            footer,
            this.config.lineEnding
        ].filter(e => e).join('\n')


        // Do not paste generated content if used changed activeLeaf
        const viewBeforeReplace = this.app.workspace.activeLeaf.view
        if (!(viewBeforeReplace instanceof MarkdownView) || viewBeforeReplace.file.basename !== currentFileName) {
            return
        }

        this.cm.replaceRange(result,
            {line: query.end + 1, ch: 0},
            {line: lastLine, ch: this.cm.getLine(lastLine)?.length || 0})

        return Promise.resolve()
    }

    private async generateTemplateFromSequences(files: TFile[], repeatableContent: string[], searchResults: Map<TFile, SearchDetails>): Promise<string> {
        const changed = await Promise.all(
            files
                .map(async (file, i) => {
                    const result = await Promise.all(repeatableContent.map(async (s) => await this.applyTemplateToSearchResults(searchResults, file, s, i)))
                    return result.join('\n')
                })
        )

        return changed.join('\n');
    }

    private parseTemplate(prefixes: { header: string; footer: string }, templateContent: string[]) {
        const isHeader = (line: string) => line.startsWith(prefixes.header)
        const isFooter = (line: string) => line.startsWith(prefixes.footer)
        const isRepeat = (line: string) => !isHeader(line) && !isFooter(line)

        const heading = templateContent.filter(isHeader).map((s) => s.slice(1)).join('\n')
        const footer = templateContent.filter(isFooter).map((s) => s.slice(1)).join('\n')
        const repeatableContent =
            templateContent.filter(isRepeat).filter(e => e).length === 0
                ? [this.config.defaultTemplate]
                : templateContent.filter(isRepeat).filter(e => e)
        return {heading, footer, repeatableContent};
    }

    private search(s: string) {
        // @ts-ignore
        const globalSearchFn = this.app.internalPlugins.getPluginById('global-search').instance.openGlobalSearch.bind(this)
        const search = (query: string) => globalSearchFn(query)

        const leftSplitState = {
            collapsed: this.app.workspace.leftSplit.collapsed,
            tab: this.getSearchTabIndex()
        }

        search(s)
        if (leftSplitState.collapsed) {
            this.app.workspace.leftSplit.collapse()
        }

        const splitChildren = this.getLeftSplitElement()
        if (leftSplitState.tab !== splitChildren.currentTab) {
            splitChildren.selectTabIndex(leftSplitState.tab)
        }
    }

    private getLeftSplitElement(): {
        currentTab: number
        selectTabIndex: (n: number) => void
        children: {
            findIndex: (c: (item: any, i: number, ar: any[]) => void) => number
        }
    } {
        // @ts-ignore
        return this.app.workspace.leftSplit.children[0];
    }

    private getSearchTabIndex(): number {
        const leftTabs = this.getLeftSplitElement().children;
        let searchTabId: string;

        this.app.workspace.iterateAllLeaves((leaf: any) => {
            if (leaf.getViewState().type == "search") {
                searchTabId = leaf.id;
            }
        });
        return leftTabs.findIndex((item: any, _index: number, _array: any[]) => {
            if (item.id == searchTabId) {
                return true;
            }
        });
    };

    private async getFoundAfterDelay(): Promise<Map<TFile, SearchDetails>> {
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

    private async applyTemplateToSearchResults(searchResults: Map<TFile, SearchDetails>, file: TFile, template: string, index: number) {
        const fileContent = (new RegExp(this.seqs.filter(e => e.readContent).map(e => e.name).join('|')).test(template))
            ? await this.app.vault.cachedRead(file)
            : ''

        return this.seqs.reduce((acc, seq) =>
            acc.replace(new RegExp(seq.name, 'gu'), replace => seq.format(this, replace, fileContent, file, searchResults.get(file), index)), template)
    }

    private clearOldResultsInFile(content: string[], query: ExpanderQuery, lineEnding: string) {
        const lastLine = getLastLineToReplace(content, query, this.config.lineEnding)
        this.cm.replaceRange('\n' + lineEnding,
            {line: query.end + 1, ch: 0},
            {line: lastLine, ch: this.cm.getLine(lastLine)?.length || 0})
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
