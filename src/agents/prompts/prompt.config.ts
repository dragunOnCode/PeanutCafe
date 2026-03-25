export const promptConfig = {
  cache: {
    enabled: true,
    maxSize: 1000,
    ttlSeconds: 3600,
  },
  template: {
    maxRecentHistory: 10,
    optionalTemplates: ['constraints.md', 'examples.md'],
  },
  watch: {
    enabled: process.env.NODE_ENV === 'development',
    debounceMs: 500,
  },
};
