import {TFile} from "obsidian";
import {trimContent} from "../helpers/helpers";
import TextExpander, {SearchDetails} from "../main";
import {off} from "codemirror";

export interface Sequences {
    loop: boolean
    name: string
    format: (plugin: TextExpander, s: string, content: string, file: TFile, results?: SearchDetails, index?: number) => string
    desc: string
    readContent?: boolean
    usingSearch?: boolean
}

interface LineInfo {
    text: string
    num: number
    start: number
    end: number
}

function highlight(lineStart: number, lineEnd: number, matchStart: number, matchEnd: number, lineContent: string) {
    return [
        ...lineContent.slice(0, matchStart - lineStart),
        '==',
        ...lineContent.slice(matchStart - lineStart, (matchStart - lineStart) + (matchEnd - matchStart)),
        '==',
        ...lineContent.slice((matchStart - lineStart) + (matchEnd - matchStart)),
    ].join('')
}

const sequences: Sequences[] = [
    {
        name: '\\$count',
        loop: true,
        format: (_p, _s: string, _content: string, _file: TFile, _d, index) => index ? String(index + 1) : String(1),
        desc: 'add index number to each produced file'
    },
    {
        name: '\\$filename',
        loop: true,
        format: (_p, _s: string, _content: string, file: TFile) => file.basename,
        desc: 'name of the founded file'
    },
    {
        name: '\\$link',
        loop: true,
        format: (p, _s: string, _content: string, file: TFile) => p.app.fileManager.generateMarkdownLink(file, file.path),
        desc: 'link based on Obsidian settings'
    },
    {
        name: '\\$lines:\\d+',
        loop: true,
        readContent: true,
        format: (p, s: string, content: string, _file: TFile) => {
            const digits = Number(s.split(':')[1])

            return trimContent(content)
                .split('\n')
                .filter((_: string, i: number) => i < digits)
                .join('\n')
                .replace(new RegExp(p.config.lineEnding, 'g'), '')
        },
        desc: 'specified count of lines from the found file'
    },
    {
        name: '\\$characters:\\d+',
        loop: true,
        readContent: true,
        format: (p, s: string, content: string, _file: TFile) => {
            const digits = Number(s.split(':')[1])

            return trimContent(content)
                .split('')
                .filter((_: string, i: number) => i < digits)
                .join('')
                .replace(new RegExp(p.config.lineEnding, 'g'), '')
        },
        desc: 'specified count of lines from the found file'
    },
    {
        name: '\\$frontmatter:[\\p\{L\}_-]+',
        loop: true,
        format: (p, s: string, _content: string, file: TFile) => p.getFrontMatter(s, file),
        desc: 'value from the frontmatter key in the found file'
    },
    {
        name: '\\$lines+',
        loop: true,
        readContent: true,
        format: (p, s: string, content: string, _file: TFile) => content.replace(new RegExp(p.config.lineEnding, 'g'), ''),
        desc: 'all content from the found file'
    },
    {
        name: '\\$ext',
        loop: true,
        format: (_p, s: string, content: string, file: TFile) => file.extension,
        desc: 'return file extension'
    },
    {
        name: '\\$created:format:date',
        loop: true,
        format: (_p, s: string, content: string, file: TFile) => String(new Date(file.stat.ctime).toISOString()).split('T')[0],
        desc: 'created time formatted'
    },
    {
        name: '\\$created:format:time',
        loop: true,
        format: (_p, s: string, content: string, file: TFile) => String(new Date(file.stat.ctime).toISOString()).split(/([.T])/)[2],
        desc: 'created time formatted'
    },
    {
        name: '\\$created:format',
        loop: true,
        format: (_p, s: string, content: string, file: TFile) => String(new Date(file.stat.ctime).toISOString()),
        desc: 'created time formatted'
    },
    {
        name: '\\$created',
        loop: true,
        format: (_p, s: string, content: string, file: TFile) => String(file.stat.ctime),
        desc: 'created time'
    },
    {
        name: '\\$size',
        loop: true,
        format: (_p, s: string, content: string, file: TFile) => String(file.stat.size),
        desc: 'size of the file'
    },
    {
        name: '\\$path',
        loop: true,
        format: (_p, s: string, content: string, file: TFile) => file.path,
        desc: 'path to the found file'
    },
    {
        name: '\\$parent',
        loop: true,
        format: (_p, s: string, content: string, file: TFile) => file.parent.name,
        desc: 'parent folder name'
    },
    {
        name: '^(.+|)\\$header:.+',
        loop: true,
        format: (p, s: string, content: string, file: TFile) => {
            const prefix = s.slice(0, s.indexOf('$'))
            const header = s.slice(s.indexOf('$')).replace('$header:', '').replace(/"/g, '')
            const neededLevel = header.split("#").length - 1
            const neededTitle = header.replace(/^#+/g, '').trim()

            const metadata = p.app.metadataCache.getFileCache(file)

            return metadata.headings?.filter(e => {
                const tests = [
                    [neededTitle, e.heading.includes(neededTitle)],
                    [neededLevel, e.level === neededLevel]
                ].filter(e => e[0])

                if (tests.length) {
                    return tests.map(e => e[1]).every(e => e === true)
                }

                return true
            })
                .map(h => p.app.fileManager.generateMarkdownLink(file, file.basename, '#' + h.heading))
                .map(link => prefix + link)
                .join('\n') || ''

        },
        desc: 'headings from founded files. $header:## - return all level 2 headings. $header:Title - return all heading which match the string. Can be prepended like: - !$header:## to transclude the headings.'
    },
    {
        name: '^(.+|)\\$blocks',
        readContent: true,
        loop: true,
        format: (p, s: string, content: string, file: TFile) => {
            const prefix = s.slice(0, s.indexOf('$'))

            return content
                .split('\n')
                .filter(e => /\^\w+$/.test(e))
                .map(e =>
                    prefix + p.app.fileManager.generateMarkdownLink(file, file.basename, '#' + e.replace(/^.+?(\^\w+$)/, '$1'))
                )
                .join('\n')
        },
        desc: 'block ids from the found files. Can be prepended.'
    },
    {
        name: '^(.+|)\\$match:header', loop: true, format: (p, s: string, content: string, file: TFile, results) => {
            const prefix = s.slice(0, s.indexOf('$'))
            const metadata = p.app.metadataCache.getFileCache(file)

            const headings = metadata.headings
                ?.filter(h => results.result.content.filter(c => h.position.end.offset < c[0]).some(e => e))
                .slice(-1)

            return headings
                .map(h => p.app.fileManager.generateMarkdownLink(file, file.path, '#' + h.heading))
                .map(link => prefix + link)
                .join('\n') || ''
        }, desc: 'extract found selections'
    },
    {
        name: '^(.+|)\\$matchline(:(\\+|-|)\\d+:\\d+|:(\\+|-|)\\d+|)',
        loop: true,
        format: (_p, s: string, content: string, file: TFile, results) => {
            const prefix = s.slice(0, s.indexOf('$matchline'));
            const [keyword, context, limit] = s.slice(s.indexOf('$matchline')).split(':')
            const value = context || '';
            const limitValue = Number(limit)
            const isPlus = value.contains('+');
            const isMinus = value.contains('-');
            const isContext = !isPlus && !isMinus;
            const offset = Number(value.replace(/[+-]/, ''));

            const lines = results.content.split('\n');

            // Grab info about line content, index, text length and start/end character position
            const lineInfos: Array<LineInfo> = []
            for (let i = 0; i < lines.length; i++) {
                const text = lines[i]

                if (i === 0) {
                    lineInfos.push({
                        num: 0,
                        start: 0,
                        end: text.length,
                        text
                    })

                    continue
                }

                const start = lineInfos[i-1].end + 1
                lineInfos.push({
                    num: i,
                    start,
                    text,
                    end: text.length + start
                })
            }

            return results.result.content.map(([from, to]) => {
                const matchedLines = lineInfos
                    .filter(({ start, end }) => start <= from && end >= to)
                    .map((line) => {
                        return {
                            ...line,
                            text: highlight(line.start, line.end, from, to, line.text)
                        }
                    })

                const resultLines: LineInfo[] = []
                for (const matchedLine of matchedLines) {
                    const prevLines = isMinus || isContext
                                ? lineInfos.filter(l => matchedLine.num - l.num > 0 && matchedLine.num - l.num < offset)
                                : []
                    const nextLines = isPlus || isContext
                                ? lineInfos.filter(l => l.num - matchedLine.num > 0 && l.num - matchedLine.num < offset)
                                : []

                    resultLines.push( ...prevLines, matchedLine, ...nextLines )
                }

                return prefix + resultLines.map(e => e.text).join('\n')
            }).map(line => limitValue ? line.slice(0, limitValue) : line).join('\n')
        }, desc: 'extract line with matches'
    },
    {
        name: '^(.+|)\\$searchresult',
        loop: true,
        desc: '',
        format: (_p, s: string, content: string, file: TFile, results) => {
            const prefix = s.slice(0, s.indexOf('$searchresult'));
            return results.children.map(matchedFile => {
                return prefix + matchedFile.el.innerText
            }).join('\n')
        }
    },
    {
        name: '^(.+|)\\$match', loop: true, format: (_p, s: string, content: string, file: TFile, results) => {

            if (!results.result.content) {
                console.warn('There is no content in results')
                return ''
            }

            function appendPrefix(prefix: string, line: string) {
                return prefix + line;
            }

            const prefixContent = s.slice(0, s.indexOf('$'))
            return results.result.content
                .map(([from, to]) => results.content.slice(from, to))
                .map(line => appendPrefix(prefixContent, line))
                .join('\n')
        }, desc: 'extract found selections'
    },
]

export default sequences