import { ExpanderQuery, formatContent, getAllExpandersQuery, getClosestQuery } from '../formatter'

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
        const formattedContent = formatContent(content)
        const result = getAllExpandersQuery(formattedContent)
        expect(result.length).toBe(1)
    })

    test('two queries', () => {
        const formattedContent = formatContent(content2)
        const result = getAllExpandersQuery(formattedContent)
        expect(result.length).toBe(2)
    })
    test('should have query', () => {
        const formattedContent = formatContent(content)
        const result = getAllExpandersQuery(formattedContent)
        expect(result[0].query).toBe('{{template}}')
    })

    test('should have template', () => {
        const formattedContent = formatContent(content2)
        const result = getAllExpandersQuery(formattedContent)
        expect(result[1].template).toBe('- [[$filename]]')
    })

    test('should have multiline template', () => {
        const formattedContent = formatContent(`\`\`\`expander\n{{template}}\nhead\nbody\nfooter\n\`\`\`\notherline\n`)
        const result = getAllExpandersQuery(formattedContent)
        expect(result[0].template).toBe('head\nbody\nfooter')
    })

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
})