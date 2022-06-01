import {TFile} from "obsidian";
import {SearchDetails} from "../main";

export function extractFilesFromSearchResults(searchResults: Map<TFile, SearchDetails>, currentFileName: string, excludeCurrent: boolean = true) {
    const files = Array.from(searchResults.keys())

    return excludeCurrent
        ? files.filter(file => file.basename !== currentFileName)
        : files;
}