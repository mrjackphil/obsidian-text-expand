import {Plugin, TFile} from "obsidian";

export function getFrontMatter(file: TFile, plugin: Plugin, s: string) {
    const {frontmatter = null} = plugin.app.metadataCache.getCache(file.path)

    if (frontmatter) {
        return frontmatter[s.split(':')[1]] || '';
    }

    return ''
}