export default ({ config }) => {
  return {
    ...config,
    extra: {
      ...config.extra,
      GEMINI_API_KEY: process.env.EXPO_PUBLIC_GEMINI_API_KEY,
    },
  };
};
