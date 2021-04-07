export interface ExpanderQuery {
    start: number
    end: number
    template: string
    query: string
}

export interface FileHeader {
    deep: number
    line: number
    name: string
}

export function getHeadersFromContent(content: string): FileHeader[] {
    return content.split('\n').map((e, i) => [e, i] as [string, number])
        .filter(([s, i]) => s.match(/^#+\s/)).map(([e, i]) => {
            const deep = e.split('#').length - 1
            const line = i

            return {
                deep,
                line,
                name: e.replace(/^#+/g, '').trim()
            }
        })
}

export function formatContent(content: string): string[] {
    return content.split('\n')
}

export function getAllExpandersQuery(content: string[]): ExpanderQuery[] {
    let accum: ExpanderQuery[] = []
    for (var i = 0; i < content.length; i++) {
        const line = content[i]

        if (line === '```expander') {
            for (var e = 0; e < content.length - i; e++) {
                const nextline = content[i + e] 
                if (nextline === '```') {
                    accum.push(
                        {
                            start: i,
                            end: i + e,
                            query: content[i + 1],
                            template: e > 2 ? content.slice(i + 2, i + e).join('\n') : ''
                        }
                    )
                    break
                }
            }
        }
    }

    return accum
}

export function getClosestQuery(queries: ExpanderQuery[], lineNumber: number): ExpanderQuery | undefined {
    if (queries.length === 0) {
        return undefined
    }

    return queries.reduce((a, b) => {
        return Math.abs(b.start - lineNumber) < Math.abs(a.start - lineNumber) ? b : a;
    });
}

export function getLastLineToReplace(content: string[], query: ExpanderQuery, endline: string) {
    const lineFrom = query.end

    for (var i = lineFrom + 1; i < content.length; i++) {
        if (content[i] === endline) {
            return i
        }
    }

    return lineFrom + 1
}

export function trimContent(s: string) {
    const removeEmptyLines = (s: string): string => {
        const lines = s.split('\n').map(e => e.trim())
        if (lines.length < 2) {
            return s
        }

        if (lines.indexOf('') === 0) {
            return removeEmptyLines(lines.slice(1).join('\n'))
        }

        return s
    }
    const removeFrontMatter = (s: string, lookEnding: boolean = false): string => {
        const lines = s.split('\n')

        if (lookEnding && lines.indexOf('---') === 0) {
            return lines.slice(1).join('\n')
        }

        if (lookEnding) {
            return removeFrontMatter(lines.slice(1).join('\n'), true)
        }

        if (lines.indexOf('---') === 0) {
            return removeFrontMatter(lines.slice(1).join('\n'), true)
        }

        return s
    }

    return removeFrontMatter(removeEmptyLines(s))
}