// Functions for string processing
export function splitByLines(content: string): string[] {
    return content.split('\n')
}

function removeEmptyLines(s: string): string  {
        const lines = s.split('\n').map(e => e.trim())

        if (lines.length < 2) {
            return s
        } else if (lines.indexOf('') === 0) {
            return removeEmptyLines(lines.slice(1).join('\n'))
        }

        return s
}

function removeFrontMatter (s: string, lookEnding: boolean = false): string {
    const lines = s.split('\n')

    if (lookEnding && lines.indexOf('---') === 0) {
        return lines.slice(1).join('\n')
    } else if (lookEnding) {
        return removeFrontMatter(lines.slice(1).join('\n'), true)
    } else if (lines.indexOf('---') === 0) {
        return removeFrontMatter(lines.slice(1).join('\n'), true)
    }

    return s
}

export function trimContent(content: string): string {
    return removeFrontMatter(removeEmptyLines(content))
}
