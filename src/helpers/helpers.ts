export interface ExpanderQuery {
    start: number
    end: number
    template: string
    query: string
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

type LooseObject<T = any> = { [key: string]: T }

export const pick = (obj: {[k: string]: any}, arr: string[]) =>
    arr.reduce((acc, curr) => {
        return (curr in obj)
            ? Object.assign({}, obj, { [curr]: obj[curr] })
            : acc
    }, <LooseObject>{});


