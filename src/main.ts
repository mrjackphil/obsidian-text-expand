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
    TFile, View, WorkspaceLeaf
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

interface SearchLeaf extends WorkspaceLeaf {
    view: View & {
        searchComponent: {
            getValue: () => string
            setValue: (s: string) => void
        }
    }
}

export interface FileParameters {
    basename: string
    content: string
    extension: string
    headings: Array<any>
    link: string
    name: string
    path: string
    sections: Array<any>
    stat: {}
    frontmatter: { [k: string]: any }
    links: Array<any>
    listItems: Array<any>
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

    leftPanelInfo: {
        collapsed: boolean
        tab: number
        text: string
    } = {
        collapsed: false,
        tab: 0,
        text: ''
    }

    constructor(app: App, plugin: PluginManifest) {
        super(app, plugin);

        this.search = this.search.bind(this);
        this.init = this.init.bind(this);
        this.autoExpand = this.autoExpand.bind(this);
    }

    async autoExpand() {
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
    }

    async onload() {
        this.addSettingTab(new SettingTab(this.app, this));

        this.registerMarkdownCodeBlockProcessor('expander', (source, el, ctx) => {
            el
                .createDiv()
                .createEl('button', {text: 'Run expand query'})
                .addEventListener('click', this.init.bind(this, false, ctx.getSectionInfo(el).lineStart))
        });

        this.addCommand({
            id: 'editor-expand',
            name: 'expand',
            callback: this.init,
            hotkeys: []
        });

        this.addCommand({
            id: 'editor-expand-all',
            name: 'expand all',
            callback: () => this.init(true),
            hotkeys: []
        });

        this.app.workspace.on('file-open', this.autoExpand);

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
        this.app.workspace.off('file-open', this.autoExpand);
    }

    async saveSettings() {
        await this.saveData(this.config)
    }

    private async init(proceedAllQueriesOnPage = false, lineToStart?: number) {
        const currentView = this.app.workspace.activeLeaf.view

        // Is on editable view
        if (!(currentView instanceof MarkdownView)) {
            return
        }

        const cmDoc: Editor = this.cm = currentView.editor

        const curNum = lineToStart || cmDoc.getCursor().line
        const content = cmDoc.getValue()

        if (lineToStart) {
            cmDoc.setCursor(lineToStart ? lineToStart - 1 : 0)
        }

        const formatted = splitByLines(content)
        const findQueries = getAllExpandersQuery(formatted)
        const closestQuery = getClosestQuery(findQueries, curNum)

        if (proceedAllQueriesOnPage) {
            await findQueries.reduce((promise, query, i) =>
                promise.then(() => {
                    const newContent = splitByLines(cmDoc.getValue())
                    const updatedQueries = getAllExpandersQuery(newContent)

                    return this.runExpanderCodeBlock(updatedQueries[i], newContent, currentView)
                }), Promise.resolve()
            )
        } else {
            await this.runExpanderCodeBlock(closestQuery, formatted, currentView)
        }
    }

    private async runExpanderCodeBlock(query: ExpanderQuery, content: string[], view: MarkdownView) {
        const {lineEnding, prefixes} = this.config

        if (!query) {
            new Notification('Expand query not found')
            return Promise.resolve()
        }

        this.clearOldResultsInFile(content, query, lineEnding);

        const newContent = splitByLines(this.cm.getValue());

        if (query.query !== '') {
            this.search(query.query)
        }
        return await this.runTemplateProcessing(query, getLastLineToReplace(newContent, query, this.config.lineEnding), prefixes, view)
    }

    private async runTemplateProcessing(query: ExpanderQuery, lastLine: number, prefixes: PluginSettings["prefixes"], currentView: MarkdownView) {
        let currentFileName = ''

        const templateContent = query.template.split('\n')

        const {heading, footer, repeatableContent} = this.parseTemplate(prefixes, templateContent);

        if (currentView instanceof FileView) {
            currentFileName = currentView.file.basename
        }

        this.saveLeftPanelState();

        const searchResults = await this.getFoundAfterDelay(query.query === '');
        const files = extractFilesFromSearchResults(searchResults, currentFileName, this.config.excludeCurrent);

        this.restoreLeftPanelState();

        currentView.editor.focus();

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

        currentView.editor.replaceRange(result,
            {line: query.end + 1, ch: 0},
            {line: lastLine, ch: this.cm.getLine(lastLine)?.length || 0})

        return Promise.resolve()
    }

    private async generateTemplateFromSequences(files: TFile[], repeatableContent: string[], searchResults?: Map<TFile, SearchDetails>): Promise<string> {
        if (!searchResults) {
            return ''
        }

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

    private saveLeftPanelState(): void {
        this.leftPanelInfo = {
            collapsed: this.app.workspace.leftSplit.collapsed,
            tab: this.getSearchTabIndex(),
            text: this.getSearchValue(),
        }
    }

    private restoreLeftPanelState() {
        const {collapsed, tab, text} = this.leftPanelInfo;
        const splitChildren = this.getLeftSplitElement()

        this.getSearchView().searchComponent.setValue(text)

        if (tab !== splitChildren.currentTab) {
            splitChildren.selectTabIndex(tab)
        }

        if (collapsed) {
            this.app.workspace.leftSplit.collapse()
        }
    }

    private search(s: string) {
        // @ts-ignore
        const globalSearchFn = this.app.internalPlugins.getPluginById('global-search').instance.openGlobalSearch.bind(this)
        const search = (query: string) => globalSearchFn(query)

        search(s)
    }

    private getLeftSplitElement(): {
        currentTab: number
        selectTabIndex: (n: number) => void
        children: Array<WorkspaceLeaf | SearchLeaf>
    } {
        // @ts-ignore
        return this.app.workspace.leftSplit.children[0];
    }

    private getSearchView(): SearchLeaf['view'] {
        const view = this.getLeftSplitElement().children.filter(e => e.getViewState().type === 'search')[0].view

        if ('searchComponent' in view) {
            return view;
        }

        return undefined;
    }

    private getSearchValue(): string {
        const view = this.getSearchView();

        if (view) {
            return view.searchComponent.getValue()
        }

        return ''
    }

    private getSearchTabIndex(): number {
        const leftTabs = this.getLeftSplitElement().children;
        let searchTabId: string;

        this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf & { id: string }) => {
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

    private async getFoundAfterDelay(immediate: boolean): Promise<Map<TFile, SearchDetails>> {
        const searchLeaf = this.app.workspace.getLeavesOfType('search')[0]
        const view = await searchLeaf.open(searchLeaf.view)

        if (immediate) {
            // @ts-ignore
            return Promise.resolve(view.dom.resultDomLookup as Map<TFile, SearchDetails>);
        }

        return new Promise(resolve => {
            setTimeout(() => {
                // @ts-ignore
                return resolve(view.dom.resultDomLookup as Map<TFile, SearchDetails>)
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
            .addTextArea(text => {
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
