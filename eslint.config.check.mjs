import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';
import globals from 'globals';
export default [{
  files: ['**/*.{js,jsx,mjs}'],
  languageOptions: {
    ecmaVersion: 2022, sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
    globals: { ...globals.browser, ...globals.node },
  },
  plugins: { react, 'react-hooks': reactHooks },
  settings: { react: { version: '18' } },
  rules: {
    'no-undef': 'error',
    'react/jsx-no-undef': 'error',
    'react/jsx-uses-vars': 'error',
    'react/jsx-uses-react': 'error',
    'react-hooks/rules-of-hooks': 'error',
  },
}];
