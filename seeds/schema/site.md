---
_kind: schema
collection: site
body: markdown
fields:
  title: { type: string, required: true, max: 80 }
  slug: { type: slug, required: true, from: title }
  author: { type: string, required: true, max: 80 }
  author_url: { type: string, required: true, max: 300 }
  links: { type: array, max_items: 12, items: { type: object, fields: { label: { type: string, required: true, max: 40 }, href: { type: string, required: true, max: 300 } } } }
indexes: []
---
# Writing guidelines for `site`

One document, slug `site`. It holds data the whole site shares, read wherever it is needed: the author, and the links that point elsewhere.

`author` is the name credited on the site and in its structured data. `author_url` is the author's own site.

`links` is the list of outbound links, in the order they appear. Keep labels to one or two words (Portfolio, Twitter, Instagram). `href` is a full URL.

The link group appears in the bottom-right corner of every page except the full-page component views. The links are also written into `/llms.txt` and into every page's structured data.

Do not create a second `site` document.
