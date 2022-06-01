import {
    ExpanderQuery,
    getAllExpandersQuery,
    getClosestQuery,
    getLastLineToReplace
} from './helpers'
import {splitByLines, trimContent} from "./string";

const content = [
    '```expander',
    '{{template}}',
    '```'
].join('\n')

const content2 = [
    '```expander',
    '{{template}}',
    '```',
    '',
    '',
    '',
    '```expander',
    '{{template}}',
    '- [[$filename]]',
    '```'
].join('\n')

describe('test query getter', () => {
    test('one query', () => {
        const formattedContent = splitByLines(content)
        const result = getAllExpandersQuery(formattedContent)
        expect(result.length).toBe(1)
    })

    test('two queries', () => {
        const formattedContent = splitByLines(content2)
        const result = getAllExpandersQuery(formattedContent)
        expect(result.length).toBe(2)
    })
    test('should have query', () => {
        const formattedContent = splitByLines(content)
        const result = getAllExpandersQuery(formattedContent)
        expect(result[0].query).toBe('{{template}}')
    })

    test('should have template', () => {
        const formattedContent = splitByLines(content2)
        const result = getAllExpandersQuery(formattedContent)
        expect(result[1].template).toBe('- [[$filename]]')
    })

    test('should have multiline template', () => {
        const formattedContent = splitByLines(`\`\`\`expander\n{{template}}\nhead\nbody\nfooter\n\`\`\`\notherline\n`)
        const result = getAllExpandersQuery(formattedContent)
        expect(result[0].template).toBe('head\nbody\nfooter')
    })

    test('should get line after query', () => {
        const excontent = [
            '```expander',
            'test',
            '```',
            'some',
            'some',
            'some'
        ]
        const query: ExpanderQuery = {
            start: 0,
            end: 2,
            query: 'test',
            template: ''
        }

        const endline = '<-->'

        const result = getLastLineToReplace(excontent, query, endline)
        expect(result).toBe(3)
    })

    test('should get last line', () => {
        const excontent = [
            '```expander',
            'test',
            '```',
            'some',
            'some',
            'some',
            '<-->'
        ]
        const query: ExpanderQuery = {
            start: 0,
            end: 2,
            query: 'test',
            template: ''
        }

        const endline = '<-->'

        const result = getLastLineToReplace(excontent, query, endline)
        expect(result).toBe(6)
    })
})

describe('test closest query getter', () => {
    test('should get first query', () => {
        const expanders: ExpanderQuery[] = [
            {
                start: 0,
                template: '',
                query: 'first',
                end: 2,
            },
            {
                start: 4,
                end: 6,
                template: '',
                query: 'second',
            },
        ]

        expect(getClosestQuery(expanders, 2).query).toBe('first')
    })

    test('should get second query', () => {
        const expanders: ExpanderQuery[] = [
            {
                start: 0,
                template: '',
                query: 'first',
                end: 2,
            },
            {
                start: 4,
                end: 6,
                template: '',
                query: 'second',
            },
        ]

        expect(getClosestQuery(expanders, 7).query).toBe('second')
    })

    test('should not throw error on empty array', () => {
        expect(getClosestQuery([], 7)).toBe(undefined)
    })
})

describe('test trim content helper', () => {
    test('remove empty lines', () => {
        const result = trimContent(`  \ntest\n test2\n`)

        expect(result).toBe(`test\ntest2\n`)
    })

    test('remove frontmatter lines', () => {
        const result = trimContent(`---\nbla-bla\n---\nresult`)

        expect(result).toBe(`result`)
    })
})
