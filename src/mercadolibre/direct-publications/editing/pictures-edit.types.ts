export type EditablePictureInput = {
  id?: string;
  source?: string;
};

export type PicturesUpdate = {
  pictures: EditablePictureInput[];
};