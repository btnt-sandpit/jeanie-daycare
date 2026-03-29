import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()]
});
```

Press **Ctrl + S** to save.

Then push the changes:
```
git add .
```
```
git commit -m "remove vite-plugin-pwa"
```
```
git push