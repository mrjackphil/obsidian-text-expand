# Text expand

![](./screenshots/1.gif)

This plugin will search files using [Obsidian search functionality](https://publish.obsidian.md/help/Plugins/Search)
and then paste the result. The output can be customized using [template feature](#template-engines).

## Table of Contents

- [Basic usage](#how-to-use)
- [Search functionality]()
- [Template engines](#template-engines)
    - [eta](#eta-template-engine)
    - [sequences](#sequence-template-engine-legacy)
        - [Available sequences](#special-sequences)

## How to use
- You should wrap your search request like that
```
    ```expander
    SEARCH_QUERY
    ```
```
- Open command palette (`Ctrl + P`)
- Find and run `Text expand: expand` command
- It should search and put results below the wrapped request

## Search functionality

First line in expander code block is always a search request.
You can leave it empty to use results from search panel as is.

Once searching, plugin waits some time (configurable) and extract results from
search panel to template engine.
 
## Template engines

### eta template engine

You can use [eta](https://eta.js.org) template engine for managing results.

```
## <%= it.current.frontmatter.title %>

<% it.files.forEach(file => { %>
   - <%= file.link %> 
<% }) %>
```

Use `it` object to access search results and fields for current file.

| Path         | Type                  | Description                      |
|--------------|-----------------------|----------------------------------|
| `it.current` | FileParameters        | Info about current file          |
| `it.files`   | Array<FileParameters> | Info about files in search panel |

`FileParameters` type has those fields.

| Name        | Type   | Description                                      | Example                                                      |
|-------------|--------|--------------------------------------------------|--------------------------------------------------------------|
| basename    | string | Name of the file                                 | `Obsidian`                                                   |
| name        | string | Full name of the file with extension             | `Obsidian.md`                                                |
| content     | string | Content of the file                              | `Obsidian\nContent of the file.`                             |
| extension   | string | Extension of the file                            | `.md`                                                        |
| link        | string | Wiki or MD link (depends on Obsidian's settings) | `[[Obsidian]]`                                               |
| path        | string | Relative to vault root path to the file          | `resources/Obsidian.md`                                      |
| frontmatter | Object | Returns all values from frontmatter              | `{ title: "Obsidian", author: MrJackphil }`                  |
| stat        | Object | File stats returned by Obsidian                  | `{ ctime: 1654089929073, mtime: 1654871855121, size: 1712 }` |
| links       | Array  | Array with links in the file                     |                                                              |
| headings    | Array  | Array with headings in the file                  |                                                              |
| sections    | Array  | Array with section of the file                   |                                                              |
| listItems   | Array  | Array with list items of the file                |                                                              |

### sequence template engine (LEGACY)
Using template feature you can customize an output. 
- Put template below the SEARCH_QUERY line
- Put a cursor inside code block with a template
- Open command palette (`Ctrl+P`) and find `Text expand: expand` command

To create a list:

    ```expander
    SEARCH_QUERY
    - [[$filename]]
    ```

or to create a table:

    ```expander
    SEARCH_QUERY
    ^|Filename|Content|
    ^|---|---|
    |$filename|$lines:1|
    ```


Syntax looks like that:

    ```expander
    SEARCH_QUERY
    ^This is a header
    This line will be repeated for each file
    Also, [[$filename]] <- this will be a link
    >This is a footer
    ```

- Line prepended with `^` is a header. It will be added at the top of the list
- Line prepended with `>` is a footer. It will be added at the bottom of the list
- Line with no special symbol at start will be repeated for each file. Also, all special sequences will be replaced.

#### Special sequences

| Regexp                   | Description                                                                                                            | Usage example                                              |
|--------------------------|------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------|
| `$filename`              | a basename of a file                                                                                                   | `$filename`                                                |
| `$link`                  | wikilink                                                                                                               | `$link`                                                    |
| `$searchresult`          | the context displayed in the Obsidian search, depending on the amount of context that is selected in the search window | `$searchresult`                                            |
| `$matchline`             | the line which contains the search query                                                                               | `$matchline`                                               |
| `$matchline:NUMBER`      | the line which contains the search query and NUMBER lines after and before matched line                                | `$matchline:10`                                            |
| `$matchline:+NUMBER`     | the line which contains the search query and NUMBER lines after matched line                                           | `$matchline:+10`                                           |
| `$matchline:COUNT:LIMIT` | the line which contains the search query and NUMBER lines around and limit line by LIMIT characters                    | `$matchline:0:10`                                          |
| `$lines`                 | the full content of the file                                                                                           | `$lines`                                                   |
| `$lines:NUMBER`          | NUMBER lines from the file                                                                                             | `$lines:10`                                                |
| `$ext`                   | extension of the file                                                                                                  |                                                            |
| `$created`               |                                                                                                                        |                                                            |
| `$size`                  |                                                                                                                        |                                                            |
| `$parent`                | parent folder                                                                                                          |                                                            |
| `$path`                  | path to file                                                                                                           |                                                            |
| `$frontmatter:NAME`      | frontmatter value from field `NAME`                                                                                    |                                                            |
| `$header:##`             | all headers as links                                                                                                   |                                                            |
| `$header:###HEADER`      | headers as links                                                                                                       | `$header:##Ideas`<br/> `$header:"## Plugins for Obsidian"` |
| `$blocks`                | all blocks paths from the note as links                                                                                |                                                            |

## Settings
- Delay (default: `100ms`) - the plugin don't wait until search completed. It waits for a delay and paste result after that.
- Line ending (default: `<-->`) - how will looks like the line below the expanded content
- Default template (default: `- [[$filename]]`) - how will look the expanded content when no template provided
- Prefixes - which prefix to use to recognize header/footer in template section

## Install
- Just use built-in plugin manager and find `Text expand` plugin

### Manually
- You need Obsidian v0.9.18+ for latest version of plugin
- Get the [Latest release](https://github.com/mrjackphil/obsidian-text-expand/releases/latest)
- Extract files and place them to your vault's plugins folder: `<vault>/.obsidian/plugins/`
- Reload Obsidian
- If prompted about Safe Mode, you can disable safe mode and enable the plugin. Otherwise, head to Settings, third-party plugins, make sure safe mode is off and enable the plugin from there.
