import { ExpanderQuery, formatContent, getAllExpandersQuery, getClosestQuery, getLastLineToReplace } from 'helpers';
import {
    App,
    View,
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

    constructor(app: App, plugin: PluginManifest) {
        super(app, plugin);

        this.search = this.search.bind(this)
        this.initExpander = this.initExpander.bind(this)
        this.reformatLinks = this.reformatLinks.bind(this)
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

        const getFrontMatter = (s: string, r: TFile) => {
            const { frontmatter = null } = this.app.metadataCache.getCache(r.path)

            if (frontmatter) {
                return frontmatter[s.split(':')[1]] || '';
            }

            return ''
        }

        const format = async (r: TFile, template: string) => {
            const fileContent = (/\$letters|\$lines/.test(template))
                ? await this.app.vault.cachedRead(r)
                : ''

            return template
                .replace(/\$filename/g, r.basename)
                .replace(/\$letters:\d+/g,
                    str => fileContent
                        .split('')
                        .filter((_: string, i: number) => i < Number(str.split(':')[1]))
                        .join(''))
                .replace(/\$lines:\d+/g,
                    str => fileContent
                        .split('\n')
                        .filter((_: string, i: number) => i < Number(str.split(':')[1]))
                        .join('\n')
                        .replace(new RegExp(this.lineEnding, 'g'), '')
                )
                .replace(/\$frontmatter:[a-zA-Z0-9_-]+/g, s => getFrontMatter(s, r))
                .replace(/\$letters+/g, (_) => fileContent.replace(new RegExp(this.lineEnding, 'g'), ''))
                .replace(/\$lines+/g, (_) => fileContent.replace(new RegExp(this.lineEnding, 'g'), ''))
                .replace(/\$ext/g, r.extension)
                .replace(/\$created/g, String(r.stat.ctime))
                .replace(/\$size/g, String(r.stat.size))
                .replace(/\$path/g, r.path)
                .replace(/\$parent/g, r.parent.name)
        }

        const changed = await Promise.all(
            filesWithoutCurrent
                .map(async (file) => {
                    const result = await Promise.all( repeatableContent .map(async (s) => await format(file, s) + '\n') )
                    return result.join('')
                })
        )

        const result =
            heading.join('\n') + '\n' +
            changed.join('\n') + '\n' +
            footer.join('\n') +
            '\n\n' +
            this.lineEnding

        this.cm.replaceRange(result,
            {line: query.end + 1, ch: 0},
            {line: lastLine, ch: this.cm.getLine(lastLine)?.length || 0})
    }

    initExpander() {
        const currentView = this.app.workspace.activeLeaf.view

        if (!(currentView instanceof MarkdownView)) {
            return
        }

        const cmDoc = this.cm = currentView.sourceMode.cmEditor
        const curNum = cmDoc.getCursor().line
        const content = cmDoc.getValue()

        const formatted = formatContent(content)
        const findQueries = getAllExpandersQuery(formatted)
        const closestQuery = getClosestQuery(findQueries, curNum)

        if (!closestQuery) {
            new Notification('Expand query not found')
            return 
        }

        this.search(closestQuery.query)
        this.startTemplateMode(closestQuery, getLastLineToReplace(formatted, closestQuery, this.lineEnding))
    }

    async onload() {
        this.addSettingTab(new SettingTab(this.app, this));

        this.addCommand({
            id: 'editor-expand',
            name: 'expand',
            callback: this.initExpander,
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
                    this.plugin.saveData({ delay: value, lineEnding: this.plugin.lineEnding, defaultTemplate: this.plugin.defaultTemplate })
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
                        this.plugin.saveData({ delay: this.plugin.delay, lineEnding: val, defaultTemplate: this.plugin.defaultTemplate })
                    })
            })

        new Setting(containerEl)
            .setName('Default template')
            .setDesc('You can specify default template')
            .addText(text => {
                text.setValue(this.plugin.defaultTemplate)
                    .onChange(val => {
                        this.plugin.defaultTemplate = val
                        this.plugin.saveData({ delay: this.plugin.delay, lineEnding: this.plugin.lineEnding, defaultTemplate: val })
                    })
            })
    }
}
