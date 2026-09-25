import LibraryCategory from "../models/LibraryCategory";

const DEFAULT_CATEGORIES = [
  { key: "musicas", title: "Músicas", description: "Trilhas sonoras organizadas por estilo e clima." },
  { key: "efeitos", title: "Efeitos sonoros", description: "Sons e efeitos para enriquecer suas produções." },
  { key: "transicoes", title: "Transições", description: "Transições modernas e profissionais." },
  { key: "luts", title: "LUTs", description: "Looks e correções de cor para seus vídeos." },
  { key: "overlays", title: "Overlays", description: "Elementos visuais para dar mais personalidade." },
  { key: "presets", title: "Presets", description: "Configurações prontas para agilizar seu workflow." },
  { key: "assets", title: "Assets", description: "Elementos gráficos, ícones e recursos extras." },
];

/** Cria as categorias que faltam; nunca sobrescreve links já configurados. */
export async function seedLibrary() {
  await Promise.all(
    DEFAULT_CATEGORIES.map((category, order) =>
      LibraryCategory.updateOne({ key: category.key }, { $setOnInsert: { ...category, order } }, { upsert: true }),
    ),
  );
}
