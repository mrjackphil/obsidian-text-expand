import {
    ExpanderQuery, FileHeader,
    formatContent,
    getAllExpandersQuery,
    getClosestQuery, getHeadersFromContent,
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

export default class TextExpander extends Plugin {
    delay = 2000;
    cm: CodeMirror.Editor
    lineEnding = '<--->'
    defaultTemplate = '- [[$filename]]'

    seqs = [
        {name: 'filename', loop: true, format: (_s: string, _content: string, file: TFile) => file.basename},
        {
            name: 'lines:\\d+', loop: true, readContent: true, format: (s: string, content: string, _file: TFile) => {
                const digits = Number(s.split(':')[1])

                return trimContent(content)
                    .split('\n')
                    .filter((_: string, i: number) => i < digits)
                    .join('\n')
                    .replace(new RegExp(this.lineEnding, 'g'), '')
            }
        },
        {
            name: 'frontmatter:[a-zA-Z0-9_-]+',
            loop: true,
            format: (s: string, _content: string, file: TFile) => this.getFrontMatter(s, file)
        },
        {
            name: 'lines+',
            loop: true,
            readContent: true,
            format: (s: string, content: string, file: TFile) => content.replace(new RegExp(this.lineEnding, 'g'), '')
        },
        {
            name: 'header:(#+\\w+|"#+.+?")',
            loop: true,
            readContent: true,
            format: (s: string, content: string, file: TFile) => {
                const header = s.replace('$header:', '').replace(/"/g, '')
                const neededLevel = header.split("#").length - 1
                const neededTitle = header.replace(/^#+/g, '')

                const contentHeaders = getHeadersFromContent(content)
                    .filter(head => head.deep === neededLevel)

                const matchedHeaderRange = (heads: FileHeader[], titleToFind: string): [number, number | undefined] => {
                    console.log(heads, titleToFind)
                    for (let i = 0; i < heads.length; i++) {
                        if (heads[i].name === titleToFind) {
                            return [heads[i].line, heads[i + 1]?.line]
                        }
                    }

                    return [0, undefined]
                }

                console.log(matchedHeaderRange(contentHeaders, neededTitle))

                return content.split('\n').slice(...matchedHeaderRange(contentHeaders, neededTitle)).join('\n')
            }
        },
        {name: 'ext', loop: true, format: (s: string, content: string, file: TFile) => file.extension},
        {name: 'created', loop: true, format: (s: string, content: string, file: TFile) => String(file.stat.ctime)},
        {name: 'size', loop: true, format: (s: string, content: string, file: TFile) => String(file.stat.size)},
        {name: 'path', loop: true, format: (s: string, content: string, file: TFile) => file.path},
        {name: 'parent', loop: true, format: (s: string, content: string, file: TFile) => file.parent.name},
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

        search(s)
    }

    async getFoundAfterDelay() {
        const searchLeaf = this.app.workspace.getLeavesOfType('search')[0]
        const view = await searchLeaf.open(searchLeaf.view)
        return new Promise(resolve => {
            // @ts-ignore
            setTimeout(() => resolve(Array.from(view.dom.resultDomLookup.keys())), this.delay)
        })
    }

    async startTemplateMode(query: ExpanderQuery, lastLine: number) {
        const files = await this.getFoundAfterDelay() as TFile[]
        const currentView = this.app.workspace.activeLeaf.view
        let currentFileName = ''

        const templateContent = query.template.split('\n')

        const heading = templateContent.filter(e => e[0] === '^').map((s) => s.slice(1))
        const footer = templateContent.filter(e => e[0] === '>').map((s) => s.slice(1))
        const repeatableContent =
            templateContent.filter(e => e[0] !== '^' && e[0] !== '>').filter(e => e).length === 0
                ? [this.defaultTemplate]
                : templateContent.filter(e => e[0] !== '^' && e[0] !== '>').filter(e => e)

        if (currentView instanceof FileView) {
            currentFileName = currentView.file.basename
        }

        const filesWithoutCurrent = files.filter(file => file.basename !== currentFileName)

        const format = async (r: TFile, template: string) => {
            const fileContent = (new RegExp(this.seqs.filter(e => e.readContent).map(e => '\\$' + e.name).join('|')).test(template))
                ? await this.app.vault.cachedRead(r)
                : ''

            return this.seqs.reduce((acc, seq) =>
                acc.replace(new RegExp('\\$' + seq.name, 'g'), replace => seq.format(replace, fileContent, r)), template)
        }

        const changed = await Promise.all(
            filesWithoutCurrent
                .map(async (file) => {
                    const result = await Promise.all(repeatableContent.map(async (s) => await format(file, s)))
                    return result.join('\n')
                })
        )

        const result = [
            heading.join('\n'),
            changed.join('\n'),
            footer.join('\n'),
            this.lineEnding
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

        this.search(query.query)
        return await this.startTemplateMode(query, getLastLineToReplace(content, query, this.lineEnding))
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

        const data = await this.loadData()
        this.delay = data?.delay || 2000
        this.lineEnding = data?.lineEnding || '<--->'
        this.defaultTemplate = data?.defaultTemplate || '- [[$filename]]'
    }

    onunload() {
        console.log('unloading plugin');
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
            .setName('Delay')
            .setDesc('Text expander don\' wait until search completed. It waits for a delay and paste result after that.')
            .addSlider(slider => {
                slider.setLimits(1000, 10000, 1000)
                slider.setValue(this.plugin.delay)
                slider.onChange(value => {
                    this.plugin.delay = value
                    this.plugin.saveData({
                        delay: value,
                        lineEnding: this.plugin.lineEnding,
                        defaultTemplate: this.plugin.defaultTemplate
                    })
                })
                slider.setDynamicTooltip()
            })

        new Setting(containerEl)
            .setName('Line ending')
            .setDesc('You can specify the text which will appear at the bottom of the generated text.')
            .addText(text => {
                text.setValue(this.plugin.lineEnding)
                    .onChange(val => {
                        this.plugin.lineEnding = val
                        this.plugin.saveData({
                            delay: this.plugin.delay,
                            lineEnding: val,
                            defaultTemplate: this.plugin.defaultTemplate
                        })
                    })
            })

        new Setting(containerEl)
            .setName('Default template')
            .setDesc('You can specify default template')
            .addText(text => {
                text.setValue(this.plugin.defaultTemplate)
                    .onChange(val => {
                        this.plugin.defaultTemplate = val
                        this.plugin.saveData({
                            delay: this.plugin.delay,
                            lineEnding: this.plugin.lineEnding,
                            defaultTemplate: val
                        })
                    })
            })
    }
}
