export default ({ config }) => {
  return {
    ...config,
    extra: {
      ...config.extra,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    },
  };
};
