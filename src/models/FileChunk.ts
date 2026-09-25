import { Schema, models, model, type Document, type Model, type Types } from "mongoose";

export interface IFileChunk extends Document {
  _id: Types.ObjectId;
  fileId: Types.ObjectId;
  n: number;
  data: Buffer;
}

const FileChunkSchema = new Schema<IFileChunk>({
  fileId: { type: Schema.Types.ObjectId, ref: "StoredFile", required: true },
  n: { type: Number, min: 0, required: true },
  data: { type: Buffer, required: true },
});

FileChunkSchema.index({ fileId: 1, n: 1 }, { unique: true });

const FileChunk: Model<IFileChunk> = models.FileChunk || model<IFileChunk>("FileChunk", FileChunkSchema);

export default FileChunk;
