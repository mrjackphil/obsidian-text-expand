import {App, Modal, View, Plugin, PluginSettingTab, Setting, TFile, FileView, MarkdownView} from 'obsidian';

interface Config {
    id: string
    name: string
    format: (e: string) => string
}

interface Files {
    file: TFile
}

function inlineLog(str: string) {
    console.log(str)
    return str
}

export default class MyPlugin extends Plugin {
    onInit() {

    }

    onload() {
        console.log('loading plugin');
        const DELAY = 2000
        const config: Config[] = [
            {
                id: 'editor:expandEmbeds',
                name: 'embeds',
                format: e => '![[' + e + ']]'
            },
            {
                id: 'editor:expandLinks',
                name: 'links',
                format: e => '[[' + e + ']]'
            },
            {
                id: 'editor:expandList',
                name: 'list of links',
                format: e => '- [[' + e + ']]'
            },
            {
                id: 'editor:expandTODO',
                name: 'list of TODO',
                format: e => '- [ ] [[' + e + ']]'
            },
        ]

        const reformatLinks = (links: Files[], mapFunc: (s: string) => string): string => {
            const currentView = this.app.workspace.activeLeaf.view

            if (currentView instanceof FileView) {
                return links.map(e => e.file.name)
                    .filter(e => currentView.file.name !== e)
                    .map(mapFunc).join('\n')
            }

            return links.map(e => e.file.name).map(mapFunc).join('\n')
        }

        function getLastLineNum(doc: CodeMirror.Doc, line = 0): number {
            const lineNum = line === 0
                ? doc.getCursor().line
                : line

            if (doc.lineCount() === lineNum) {
                return doc.getCursor().line + 1
            }

            return doc.getLine(lineNum) === '---'
                ? lineNum
                : getLastLineNum(doc, lineNum + 1)
        }

        const initExpander = (mapFunc: (e: string) => string) => {
            // Search files
            let cmDoc = null as CodeMirror.Doc || null
            // @ts-ignore
            const search = (query: string) => this.app.globalSearch.openGlobalSearch(inlineLog(query))
            const getFoundFilenames = (mapFunc: (s: string) => string, callback: (s: string) => any) => {
                const searchLeaf = this.app.workspace.getLeavesOfType('search')[0]
                searchLeaf.open(searchLeaf.view)
                    .then((view: View) => setTimeout(() => {
                        // Using undocumented feature
                        // @ts-ignore
                        const result = reformatLinks(view.dom.resultDoms, mapFunc)
                        callback(result)
                    }, DELAY))
            }

            const currentView = this.app.workspace.activeLeaf.view

            if (currentView instanceof MarkdownView) {
                cmDoc = currentView.sourceMode.cmEditor
            }

            const hasFormulaRegexp = /^\{\{.+\}\}$/
            const curNum = cmDoc.getCursor().line
            const curText = cmDoc.getLine(curNum)

            if (!hasFormulaRegexp.test(curText)) {
                return
            }

            const isEmbed = cmDoc.getLine(curNum - 1) === '```expander'
                && cmDoc.getLine(curNum + 1) === '```'

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
            getFoundFilenames(mapFunc, replaceLine)
        }

        config.forEach(e => {
            this.addCommand({
                id: e.id,
                name: e.name,
                callback: () => initExpander(e.format),
                hotkeys: []
            })
        })
    }

    onunload() {
        console.log('unloading plugin');
    }
}

class SampleModal extends Modal {
    constructor(app: App) {
        super(app);
    }

    onOpen() {
        let {contentEl} = this;
        contentEl.setText('Woah!');
    }

    onClose() {
        let {contentEl} = this;
        contentEl.empty();
    }
}

class SampleSettingTab extends PluginSettingTab {
    display(): void {
        let {containerEl} = this;

        containerEl.empty();

        containerEl.createEl('h2', {text: 'Settings for my awesome plugin.'});

        new Setting(containerEl)
            .setName('Setting #1')
            .setDesc('It\'s a secret')
            .addText(text => text.setPlaceholder('Enter your secret')
                .setValue('')
                .onChange((value) => {
                    console.log('Secret: ' + value);
                }));

    }
}
