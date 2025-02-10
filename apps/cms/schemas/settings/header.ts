export default {
  name: 'settings.header',
  type: 'document',
  fields: [
    {
      name: 'navLinks',
      type: 'array',
      of: [{type: 'link'}],
    },
  ],
}
