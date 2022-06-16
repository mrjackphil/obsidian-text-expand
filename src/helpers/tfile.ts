import {Plugin, TFile} from "obsidian";
import {pick} from "./helpers";
import {FileParameters} from "../main";

export function getFrontMatter(file: TFile, plugin: Plugin, s: string) {
    const {frontmatter = null} = plugin.app.metadataCache.getCache(file.path)

    if (frontmatter) {
        return frontmatter[s.split(':')[1]] || '';
    }

    return ''
}

export async function getFileInfo(this: void, plugin: Plugin, file: TFile): Promise<FileParameters> {
    const info = Object.assign({}, file, {
            content: file.extension === 'md' ? await plugin.app.vault.cachedRead(file) : '',
            link: plugin.app.fileManager.generateMarkdownLink(file, file.name).replace(/^!/, '')
        },
        plugin.app.metadataCache.getFileCache(file)
    )
    return pick(info, [
        'basename',
        'content',
        'extension',
        'headings',
        'link', 'name',
        'path', 'sections', 'stat',
        'frontmatter',
        'links',
        'listItems'
    ])
}