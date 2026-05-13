export const renderTemplate = (
  template: string,
  variables: Record<string, string>,
): string => {
  return Object.entries(variables).reduce(
    (rendered, [key, value]) => rendered.replaceAll(`{{${key}}}`, value),
    template,
  );
};
