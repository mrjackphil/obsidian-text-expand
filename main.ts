import {App, View, Plugin, PluginSettingTab, Setting, TFile, FileView, MarkdownView, PluginManifest} from 'obsidian';

interface Files {
    file: TFile
}

function inlineLog(str: string) {
    console.log(str)
    return str
}

export default class TextExpander extends Plugin {
    delay = 2000;
    cm: CodeMirror.Editor

    constructor(app: App, plugin: PluginManifest) {
        super(app, plugin);

        this.search = this.search.bind(this)
        this.initExpander = this.initExpander.bind(this)
        this.getLastLineNum = this.getLastLineNum.bind(this)
        this.reformatLinks = this.reformatLinks.bind(this)
    }

    reformatLinks(links: Files[], mapFunc = (s: string) => '[[' + s + ']]') {
        const currentView = this.app.workspace.activeLeaf.view

        if (currentView instanceof FileView) {
            return links.map(e => e.file.basename)
                .filter(e => currentView.file.basename !== e)
                .map(mapFunc).join('\n')
        }

        return links.map(e => e.file.basename).map(mapFunc).join('\n')
    }

    getLastLineNum(doc: CodeMirror.Doc, line = 0): number {
        const lineNum = line === 0
            ? doc.getCursor().line
            : line

        if (doc.lineCount() === lineNum) {
            return doc.getCursor().line + 1
        }

        return doc.getLine(lineNum) === '---'
            ? lineNum
            : this.getLastLineNum(doc, lineNum + 1)
    }

    getLinesOffsetToGoal(start: number, goal: string, step = 1): number {
        const lineCount = this.cm.lineCount()
        let offset = 0

        while (!isNaN(start + offset) && start + offset < lineCount && start + offset > 0) {
            const result = goal === this.cm.getLine(start + offset)

            if (result) {
                return offset
            }

            offset += step
        }

        return start
    }

    getContentBetweenLines(fromLineNum: number, startLine: string, endLine: string) {
        const {cm} = this
        const topOffset = this.getLinesOffsetToGoal(fromLineNum, startLine, -1)
        const botOffset = this.getLinesOffsetToGoal(fromLineNum, endLine, 1)

        const topLine = fromLineNum - topOffset - 1
        const botLine = fromLineNum + botOffset - 1

        return cm.getRange({line: topLine, ch: 0},
            {line: botLine, ch: cm.getLine(botLine).length})
    }

    search(s: string) {
        // @ts-ignore
        const globalSearchFn = this.app.internalPlugins.getPluginById('global-search').instance.openGlobalSearch.bind(this)
        const search = (query: string) => globalSearchFn(inlineLog(query))

        search(s)
    }

    async getFoundAfterDelay(mapFunc = (s: string) => '[[' + s + ']]' ) {
        const searchLeaf = this.app.workspace.getLeavesOfType('search')[0]
        const view = await searchLeaf.open(searchLeaf.view)
        return new Promise(resolve => {
            // @ts-ignore
            setTimeout(() => resolve(view.dom.resultDoms.map(e => e.file)), this.delay)
        })
    }

    initExpander() {
        const {reformatLinks, getLastLineNum, search} = this
        const getFoundFilenames = (callback: (s: string) => any) => {
            const searchLeaf = this.app.workspace.getLeavesOfType('search')[0]
            searchLeaf.open(searchLeaf.view)
                .then((view: View) => setTimeout(() => {
                    // @ts-ignore
                    const result = reformatLinks(view.dom.resultDoms)
                    callback(result)
                }, this.delay))
        }

        const currentView = this.app.workspace.activeLeaf.view

        if (!(currentView instanceof MarkdownView)) {
            return
        }

        const cmDoc = this.cm = currentView.sourceMode.cmEditor
        // @ts-ignore
        const isVim = this.app.vault.config.vimMode

        const hasFormulaRegexp = /^{{.+}}$/
        const curNum = cmDoc.getCursor().line
        const curText = cmDoc.getLine(curNum)

        if (!hasFormulaRegexp.test(curText)) {
            return
        }

        const isEmbed = cmDoc.getLine(curNum - 1) === '```expander'

        if (isEmbed && this.checkTemplateMode(curNum)) { return }

        const fstLineNumToReplace = isEmbed
            ? curNum - 1
            : curNum
        const lstLineNumToReplace = isEmbed
            ? getLastLineNum(cmDoc)
            : curNum

        const searchQuery = curText.replace('{{', '').replace('}}', '')
        const embedFormula = '```expander\n' +
            '{{' + searchQuery + '}}\n' +
            '```\n'

        const replaceLine = (content: string) => cmDoc.replaceRange(embedFormula + content + '\n\n---',
            {line: fstLineNumToReplace, ch: 0},
            {line: lstLineNumToReplace, ch: cmDoc.getLine(lstLineNumToReplace).length}
        )

        search(inlineLog(searchQuery))
        getFoundFilenames(replaceLine)
    }

    checkTemplateMode(curLineNum: number) {
        const content = this.getContentBetweenLines(curLineNum, '```expander', '```').split('\n')
        const hasTemplate = content.length > 1

        console.log(content)

        if (!hasTemplate) {
            return false
        }

        this.startTemplateMode(content, curLineNum)

        return true
    }

    async startTemplateMode(c: string[], n: number) {
        const [f, ...t] = c
        this.search(f.replace(/[\{\{|\}\}]/g, ''))
        const files = await this.getFoundAfterDelay(s => s) as TFile[]

        const format = (s: string) => files.map((r: TFile) => s
            .replace('$filename', r.basename)
            .replace('$created', String(r.stat.ctime))
            .replace('$size', String(r.stat.size)))
            .join('\n')

        const result = t
            .map(s => s
                .split('')[0] === '>'
                    ? format(s.replace(/^>/, ''))
                    : s )
            .join('\n') + '\n---'
        const lstLine = this.getLastLineNum(this.cm, n + t.length)

        this.cm.replaceRange(result,
            {line: n + t.length + 2, ch: 0},
            {line: lstLine, ch: this.cm.getLine(lstLine).length})
    }

    onload() {
        this.addSettingTab(new SettingTab(this.app, this));

        this.addCommand({
            id: 'editor-expand',
            name: 'expand',
            callback: this.initExpander,
            hotkeys: []
        })
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
                slider.onChange(value => this.plugin.delay = value)
                slider.setDynamicTooltip()
            })
    }
}
