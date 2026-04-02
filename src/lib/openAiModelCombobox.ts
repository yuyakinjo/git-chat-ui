import { DEFAULT_OPENAI_MODEL } from "../lib/commitTitlePrompt";

export function buildOpenAiModelOptions(
  availableModels: string[],
  selectedModel: string,
): string[] {
  const merged = new Set<string>();
  const normalizedSelectedModel = selectedModel.trim();

  if (normalizedSelectedModel) {
    merged.add(normalizedSelectedModel);
  }

  merged.add(DEFAULT_OPENAI_MODEL);

  for (const availableModel of availableModels) {
    const normalizedModel = availableModel.trim();
    if (normalizedModel) {
      merged.add(normalizedModel);
    }
  }

  return [...merged].sort((left, right) => {
    if (left === normalizedSelectedModel && right !== normalizedSelectedModel) {
      return -1;
    }

    if (right === normalizedSelectedModel && left !== normalizedSelectedModel) {
      return 1;
    }

    if (left === DEFAULT_OPENAI_MODEL && right !== DEFAULT_OPENAI_MODEL) {
      return -1;
    }

    if (right === DEFAULT_OPENAI_MODEL && left !== DEFAULT_OPENAI_MODEL) {
      return 1;
    }

    return left.localeCompare(right);
  });
}

function normalizeOpenAiModelFilterQuery(filterQuery: string): string {
  return filterQuery.trim().toLocaleLowerCase();
}

export function filterOpenAiModelOptions(modelOptions: string[], filterQuery: string): string[] {
  const normalizedFilterQuery = normalizeOpenAiModelFilterQuery(filterQuery);
  if (!normalizedFilterQuery) {
    return modelOptions;
  }

  return modelOptions.filter((modelId) =>
    modelId.toLocaleLowerCase().includes(normalizedFilterQuery),
  );
}

export function resolveListboxScrollTop(args: {
  optionOffsetTop: number;
  optionOffsetHeight: number;
  listScrollTop: number;
  listClientHeight: number;
}): number {
  const { optionOffsetTop, optionOffsetHeight, listScrollTop, listClientHeight } = args;
  if (listClientHeight <= 0) {
    return listScrollTop;
  }

  const optionBottom = optionOffsetTop + optionOffsetHeight;
  const visibleBottom = listScrollTop + listClientHeight;
  if (optionOffsetTop < listScrollTop) {
    return optionOffsetTop;
  }

  if (optionBottom > visibleBottom) {
    return optionBottom - listClientHeight;
  }

  return listScrollTop;
}
