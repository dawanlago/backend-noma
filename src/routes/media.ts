import { Router } from "express";
import { cloudinaryConfig, signParams } from "../lib/cloudinary";

/** Rotas internas de mídia (usuário logado), montadas depois do login. */
export const privateRouter = Router();

/**
 * Versões geradas pelo Cloudinary logo após o envio (em segundo plano):
 * mp4 H.264 até 1920px para tocar em qualquer navegador e o quadro de 1s como capa.
 * Manter igual a VIDEO_PLAYBACK/VIDEO_POSTER em frontend src/lib/proposals/video.ts.
 */
const VIDEO_EAGER = "c_limit,q_auto,vc_h264,w_1920/mp4|q_auto,so_1/jpg";

/**
 * POST /uploads/sign-video — assinatura para enviar um vídeo do portfólio direto
 * do navegador ao Cloudinary (o arquivo não passa pelo servidor). A mesma
 * assinatura vale para todas as partes de um envio em partes (chunked).
 */
privateRouter.post("/uploads/sign-video", (_req, res, next) => {
  try {
    const config = cloudinaryConfig();
    if (!config) {
      res.status(503).json({ error: "O envio de arquivos não está configurado (CLOUDINARY_URL)." });
      return;
    }
    const timestamp = Math.floor(Date.now() / 1000);
    const params = { eager: VIDEO_EAGER, eager_async: "true", folder: "noma/propostas", timestamp };
    res.json({
      data: {
        cloudName: config.cloudName,
        apiKey: config.apiKey,
        timestamp,
        folder: params.folder,
        eager: params.eager,
        eagerAsync: params.eager_async,
        signature: signParams(params, config.apiSecret),
      },
    });
  } catch (error) {
    next(error);
  }
});
