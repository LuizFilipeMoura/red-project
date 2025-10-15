export default {
  "**/*.{ts,tsx,js,jsx,json,md,css,scss}": ["prettier --write"],
  "**/*.{ts,tsx,js,jsx}": ["eslint --fix"],
};
