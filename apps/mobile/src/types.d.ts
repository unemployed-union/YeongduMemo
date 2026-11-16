declare module 'markdown-it-task-lists' {
  import type { PluginSimple } from 'markdown-it';
  const plugin: PluginSimple;
  export default plugin;
}

declare module '*.png' {
  import type { ImageSourcePropType } from 'react-native';
  const image: ImageSourcePropType;
  export default image;
}
