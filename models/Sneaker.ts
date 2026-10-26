import mongoose, { Schema } from "mongoose";
import type { HydratedDocument, Model } from "mongoose";

export type Retailer = "stockX" | "stadiumGoods" | "goat" | "flightClub" | "klekt";
export type PriceMap = Record<string, number>;
export interface ProviderError {
  provider: Retailer;
  operation: "links" | "prices" | "pictures";
  message: string;
}

export interface SneakerData {
  shoeName?: string;
  brand?: string;
  // Retain the original spelling for response compatibility.
  silhoutte?: string;
  styleID: string;
  retailPrice?: number;
  releaseDate?: string;
  description?: string;
  imageLinks: string[];
  thumbnail?: string;
  urlKey?: string;
  make?: string;
  goatProductId?: number;
  colorway?: string;
  resellLinks: Partial<Record<Retailer, string>>;
  size?: number;
  lowestResellPrice: Partial<Record<Retailer, number>>;
  resellPrices: Partial<Record<Retailer, PriceMap>>;
  providerErrors: ProviderError[];
}

export type SneakerDocument = HydratedDocument<SneakerData>;

const SneakerSchema = new Schema<SneakerData>({
  shoeName: String,
  brand: String,
  silhoutte: String,
  styleID: { type: String, required: true },
  retailPrice: Number,
  releaseDate: String,
  description: String,
  imageLinks: { type: [String], default: [] },
  thumbnail: String,
  urlKey: String,
  make: String,
  goatProductId: Number,
  colorway: String,
  resellLinks: {
    stockX: String,
    stadiumGoods: String,
    goat: String,
    flightClub: String,
    klekt: String,
  },
  size: Number,
  lowestResellPrice: {
    stockX: Number,
    stadiumGoods: Number,
    goat: Number,
    flightClub: Number,
    klekt: Number,
  },
  resellPrices: {
    stockX: { type: Object, default: {} },
    goat: { type: Object, default: {} },
    stadiumGoods: { type: Object, default: {} },
    flightClub: { type: Object, default: {} },
    klekt: { type: Object, default: {} },
  },
  providerErrors: {
    type: [new Schema<ProviderError>({
      provider: { type: String, required: true },
      operation: { type: String, required: true },
      message: { type: String, required: true },
    }, { _id: false })],
    default: [],
  },
});

const Sneaker: Model<SneakerData> = mongoose.model<SneakerData>("Sneaker", SneakerSchema);
export default Sneaker;
