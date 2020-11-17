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

    getFstLineNum(doc: CodeMirror.Doc, line = 0): number {
        const lineNum = line === 0
            ? doc.getCursor().line
            : line

        if (doc.lineCount() === lineNum) {
            return doc.getCursor().line + 1
        }

        return doc.getLine(lineNum) === '```'
            ? lineNum + 1
            : this.getFstLineNum(doc, lineNum + 1)
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

        const topLine = fromLineNum + topOffset + 1
        const botLine = fromLineNum + botOffset - 1

        return cm.getRange({line: topLine || fromLineNum, ch: 0},
            {line: botLine || fromLineNum, ch: cm.getLine(botLine)?.length })
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

        const curNum = cmDoc.getCursor().line
        const curText = cmDoc.getLine(curNum)
        const workingLine = this.getContentBetweenLines(curNum, '```expander', '```') || curText

        const hasFormulaRegexp = /^{{.+}}/

        if (!hasFormulaRegexp.test(workingLine)) {
            return
        }

        const isEmbed = workingLine.split('\n').length > 1 || cmDoc.getLine(curNum - 1) === '```expander'

        if (isEmbed && this.checkTemplateMode(workingLine, curNum)) { return }

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

    checkTemplateMode(content: string, curLineNum: number) {
        const hasTemplate = content.split('\n').length > 1

        if (!hasTemplate) {
            return false
        }

        this.startTemplateMode(content, curLineNum)

        return true
    }

    async startTemplateMode(content: string, n: number) {
        const [searchFormula, ...templateContent] = content.split('\n')
        this.search(searchFormula.replace(/[\{\{|\}\}]/g, ''))
        const files = await this.getFoundAfterDelay(s => s) as TFile[]
        const currentView = this.app.workspace.activeLeaf.view
        let currentFileName = ''

        const heading = templateContent.filter(e => e[0] === '^').map(([_, ...tail]) => tail)
        const footer = templateContent.filter(e => e[0] === '>').map(([_, ...tail]) => tail)
        const repeatableContent = templateContent.filter(e => e[0] !== '^' && e[0] !== '>')

        if (currentView instanceof FileView) {
            currentFileName = currentView.file.basename
        }

        const filesWithoutCurrent = files.filter(file => file.basename !== currentFileName)

        const format = (r: TFile, s: string) => s
                .replace(/\$filename/g, r.basename)
                .replace(/\$letters:\d+/g,
                        str => r.cachedData
                            .split('')
                            .filter(
                                (_: string, i: number) => i < Number(str.split(':')[1])
                            ).join('')
                )
                .replace(/\$lines:\d+/g,
                    str => r.cachedData
                        .split('\n')
                        .filter(
                            (_: string, i: number) => i < Number(str.split(':')[1])
                        ).join('\n')
                )
                .replace(/\$letters+/g, r.cachedData)
                .replace(/\$lines+/g, r.cachedData)
                .replace(/\$ext/g, r.extension)
                .replace(/\$created/g, String(r.stat.ctime))
                .replace(/\$size/g, String(r.stat.size))
		.replace(/\$path/g, r.path)
		.replace(/\$parent/g, r.parent.name)

        const changed = filesWithoutCurrent.map(file => repeatableContent.map(s => format(file, s)).join('\n'))

        const result = heading.join('\n') + '\n' + changed.join('\n') + '\n' + footer.join('\n') + '\n\n---'

        const fstLine = this.getFstLineNum(this.cm, n)
        const lstLine = this.getLastLineNum(this.cm, fstLine)

        this.cm.replaceRange(result,
            {line: fstLine, ch: 0},
            {line: lstLine, ch: this.cm.getLine(lstLine).length})
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
                    this.plugin.saveData({ delay: value })
                })
                slider.setDynamicTooltip()
            })
    }
}
