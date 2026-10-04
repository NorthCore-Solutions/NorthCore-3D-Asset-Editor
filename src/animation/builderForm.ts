// Preserve the builder's existing FormData coercion for its document and inspector forms.
export const textField = (data: FormData, name: string) => {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
};
export const number = (data: FormData, name: string) => Number(data.get(name));
