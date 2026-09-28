import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

// React'i global olarak kullanılabilir yap
global.React = React;

// Her testten sonra temizlik
afterEach(() => {
  cleanup();
});

// localStorage ve sessionStorage'ı temizle
afterEach(() => {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.clear) {
      localStorage.clear();
    }
  } catch (e) {}
  try {
    if (typeof sessionStorage !== 'undefined' && sessionStorage.clear) {
      sessionStorage.clear();
    }
  } catch (e) {}
});

