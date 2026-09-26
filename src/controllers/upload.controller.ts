import type { NextFunction, Request, Response } from "express";
import { cloudinaryConfig, signParams, UPLOAD_FOLDERS, type UploadFolder } from "../lib/cloudinary";

/**
 * POST /uploads/sign { folder } — assinatura para o navegador enviar o arquivo
 * direto ao Cloudinary (o segredo nunca sai do servidor).
 */
export function signUpload(req: Request, res: Response, next: NextFunction) {
  try {
    const config = cloudinaryConfig();
    if (!config) {
      res.status(503).json({ error: "O envio de arquivos não está configurado (CLOUDINARY_URL)." });
      return;
    }
    const folder = req.body.folder as UploadFolder;
    if (!UPLOAD_FOLDERS.includes(folder)) {
      res.status(400).json({ error: "Pasta de envio inválida." });
      return;
    }
    const timestamp = Math.floor(Date.now() / 1000);
    const params = { folder: `noma/${folder}`, timestamp };
    res.json({
      data: {
        cloudName: config.cloudName,
        apiKey: config.apiKey,
        timestamp,
        folder: params.folder,
        signature: signParams(params, config.apiSecret),
      },
    });
  } catch (error) {
    next(error);
  }
}
