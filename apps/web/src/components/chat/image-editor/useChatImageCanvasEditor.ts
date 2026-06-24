import {
  computed,
  nextTick,
  onBeforeUnmount,
  reactive,
  shallowRef,
  type Ref,
} from 'vue';
import type {
  ChatImageCropResetState,
  ChatImageEditorFilter,
  ChatImageEditorShape,
  ChatImageExportResult,
} from './types';

interface UseChatImageCanvasEditorOptions {
  canvasRef: Ref<HTMLCanvasElement | null>;
  viewportRef: Ref<HTMLElement | null>;
}

type Point = {
  x: number;
  y: number;
};

type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DrawingMode = {
  color: string;
  width: number;
  blur?: boolean;
} | null;

type TextOverlay = {
  visible: boolean;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  isDragging: boolean;
  dragOffsetX: number;
  dragOffsetY: number;
};

type ShapeOverlay = {
  visible: boolean;
  shape: ChatImageEditorShape;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  isDragging: boolean;
  isResizing: boolean;
  isRotating: boolean;
  dragOffsetX: number;
  dragOffsetY: number;
  resizeStartX: number;
  resizeStartY: number;
  resizeStartWidth: number;
  resizeStartHeight: number;
  rotateStartAngle: number;
  rotateStartRotation: number;
};

type BlurOverlay = {
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  intensity: number;
  isDragging: boolean;
  isResizing: boolean;
  dragOffsetX: number;
  dragOffsetY: number;
  resizeStartX: number;
  resizeStartY: number;
  resizeStartWidth: number;
  resizeStartHeight: number;
};

type EmojiOverlay = {
  visible: boolean;
  emoji: string;
  x: number;
  y: number;
  fontSize: number;
  isDragging: boolean;
  isResizing: boolean;
  dragOffsetX: number;
  dragOffsetY: number;
  resizeStartX: number;
  resizeStartY: number;
  resizeStartFontSize: number;
};

const editableMimeTypes = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

const getOutputMimeType = (file: File): string => {
  if (editableMimeTypes.has(file.type)) return file.type;
  return 'image/png';
};

const getEditedFileName = (file: File, mimeType: string): string => {
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const baseName = file.name.replace(/\.[^/.]+$/, '') || 'image';
  return `${baseName}-edited.${extension}`;
};

const dataUrlToFile = async (
  dataUrl: string,
  sourceFile: File
): Promise<File> => {
  const mimeType = getOutputMimeType(sourceFile);
  const response = await fetch(dataUrl);
  const blob = await response.blob();

  return new File([blob], getEditedFileName(sourceFile, mimeType), {
    type: blob.type || mimeType,
  });
};

const loadHtmlImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load image'));
    image.src = src;
  });

const getCanvasPoint = (event: PointerEvent, canvas: HTMLCanvasElement): Point => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / Math.max(1, rect.width);
  const scaleY = canvas.height / Math.max(1, rect.height);

  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
};

const normalizeCropRect = (rect: CropRect, canvas: HTMLCanvasElement): CropRect => {
  const x = Math.max(0, Math.min(rect.x, rect.x + rect.width));
  const y = Math.max(0, Math.min(rect.y, rect.y + rect.height));
  const width = Math.min(Math.abs(rect.width), canvas.width - x);
  const height = Math.min(Math.abs(rect.height), canvas.height - y);

  return { x, y, width, height };
};

const getFilterStyle = (filter: ChatImageEditorFilter): string => {
  const filterMap: Record<ChatImageEditorFilter, string> = {
    none: 'none',
    pop: 'saturate(1.34) contrast(1.14) brightness(1.06)',
    grayscale: 'grayscale(1)',
    cold: 'saturate(1.08) sepia(0.08) hue-rotate(178deg)',
    chrome: 'saturate(1.42) contrast(1.22) brightness(1.04)',
    film: 'sepia(0.58) contrast(1.08) saturate(0.96)',
  };

  return filterMap[filter];
};

const getOutputFormat = (file: File): 'jpeg' | 'png' | 'webp' => {
  const mimeType = getOutputMimeType(file);
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpeg';
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const getAngleDegrees = (center: Point, point: Point): number =>
  (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;

const drawArrowHead = (
  context: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
) => {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const size = 18;

  context.beginPath();
  context.moveTo(toX, toY);
  context.lineTo(
    toX - size * Math.cos(angle - Math.PI / 6),
    toY - size * Math.sin(angle - Math.PI / 6)
  );
  context.lineTo(
    toX - size * Math.cos(angle + Math.PI / 6),
    toY - size * Math.sin(angle + Math.PI / 6)
  );
  context.closePath();
  context.fill();
};

export const useChatImageCanvasEditor = ({
  canvasRef,
  viewportRef,
}: UseChatImageCanvasEditorOptions) => {
  const sourceImage = shallowRef<HTMLImageElement | null>(null);
  const activeFilter = shallowRef<ChatImageEditorFilter>('none');
  const rotation = shallowRef(0);
  const drawingMode = shallowRef<DrawingMode>(null);
  const cropRect = shallowRef<CropRect | null>(null);
  const isPointerDrawing = shallowRef(false);
  const isPointerCropping = shallowRef(false);
  const pointerStart = shallowRef<Point | null>(null);
  const lastPoint = shallowRef<Point | null>(null);
  const historyStack = shallowRef<ImageData[]>([]);
  const historyIndex = shallowRef(-1);
  const isReady = computed(() => !!canvasRef.value && !!sourceImage.value);
  const hasCropRect = computed(() => !!cropRect.value);
  const canUndo = computed(() => historyIndex.value > 0);
  const canRedo = computed(
    () => historyIndex.value >= 0 && historyIndex.value < historyStack.value.length - 1
  );
  const textOverlay = reactive<TextOverlay>({
    visible: false,
    text: '',
    x: 0,
    y: 0,
    fontSize: 34,
    isDragging: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
  });
  const shapeOverlay = reactive<ShapeOverlay>({
    visible: false,
    shape: 'rect',
    color: '#ffffff',
    x: 0,
    y: 0,
    width: 160,
    height: 100,
    rotation: 0,
    isDragging: false,
    isResizing: false,
    isRotating: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
    resizeStartX: 0,
    resizeStartY: 0,
    resizeStartWidth: 0,
    resizeStartHeight: 0,
    rotateStartAngle: 0,
    rotateStartRotation: 0,
  });
  const blurOverlay = reactive<BlurOverlay>({
    visible: false,
    x: 0,
    y: 0,
    width: 180,
    height: 100,
    intensity: 50,
    isDragging: false,
    isResizing: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
    resizeStartX: 0,
    resizeStartY: 0,
    resizeStartWidth: 0,
    resizeStartHeight: 0,
  });
  const emojiOverlay = reactive<EmojiOverlay>({
    visible: false,
    emoji: '',
    x: 0,
    y: 0,
    fontSize: 54,
    isDragging: false,
    isResizing: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
    resizeStartX: 0,
    resizeStartY: 0,
    resizeStartFontSize: 54,
  });
  const textOverlayStyle = computed(() => ({
    fontSize: `${textOverlay.fontSize}px`,
    insetInlineStart: `${textOverlay.x}px`,
    insetBlockStart: `${textOverlay.y}px`,
  }));
  const shapeOverlayStyle = computed(() => ({
    '--shape-color': shapeOverlay.color,
    blockSize: `${shapeOverlay.height}px`,
    inlineSize: `${shapeOverlay.width}px`,
    insetBlockStart: `${shapeOverlay.y}px`,
    insetInlineStart: `${shapeOverlay.x}px`,
    transform: `translate(-50%, -50%) rotate(${shapeOverlay.rotation}deg)`,
    transformOrigin: 'center',
  }));
  const blurOverlayStyle = computed(() => ({
    '--blur-strength': `${Math.max(6, blurOverlay.intensity / 6)}px`,
    blockSize: `${blurOverlay.height}px`,
    inlineSize: `${blurOverlay.width}px`,
    insetBlockStart: `${blurOverlay.y}px`,
    insetInlineStart: `${blurOverlay.x}px`,
  }));
  const emojiOverlayStyle = computed(() => ({
    blockSize: `${emojiOverlay.fontSize * 1.28}px`,
    fontSize: `${emojiOverlay.fontSize}px`,
    inlineSize: `${emojiOverlay.fontSize * 1.28}px`,
    insetBlockStart: `${emojiOverlay.y}px`,
    insetInlineStart: `${emojiOverlay.x}px`,
  }));
  const directLayer = reactive({
    canvas: null as HTMLCanvasElement | null,
    context: null as CanvasRenderingContext2D | null,
  });

  const getCanvas = (): HTMLCanvasElement | null => canvasRef.value;

  const getContext = (): CanvasRenderingContext2D | null => {
    const canvas = getCanvas();
    return canvas?.getContext('2d') ?? null;
  };

  const syncDirectLayer = (width: number, height: number) => {
    if (!directLayer.canvas) {
      directLayer.canvas = document.createElement('canvas');
      directLayer.context = directLayer.canvas.getContext('2d');
    }

    directLayer.canvas.width = width;
    directLayer.canvas.height = height;
    directLayer.context?.clearRect(0, 0, width, height);
  };

  const captureLayerState = (): ImageData | null => {
    if (!directLayer.canvas || !directLayer.context) return null;

    return directLayer.context.getImageData(
      0,
      0,
      directLayer.canvas.width,
      directLayer.canvas.height
    );
  };

  const resetHistory = () => {
    const initialState = captureLayerState();
    historyStack.value = initialState ? [initialState] : [];
    historyIndex.value = initialState ? 0 : -1;
  };

  const commitHistory = () => {
    const nextState = captureLayerState();
    if (!nextState) return;

    historyStack.value = [
      ...historyStack.value.slice(0, historyIndex.value + 1),
      nextState,
    ];
    historyIndex.value = historyStack.value.length - 1;
  };

  const restoreHistory = (nextIndex: number) => {
    if (!directLayer.canvas || !directLayer.context) return;

    const nextState = historyStack.value[nextIndex];
    if (!nextState) return;

    directLayer.context.clearRect(
      0,
      0,
      directLayer.canvas.width,
      directLayer.canvas.height
    );
    directLayer.context.putImageData(nextState, 0, 0);
    historyIndex.value = nextIndex;
    redraw();
  };

  const hideTextOverlay = () => {
    textOverlay.visible = false;
    textOverlay.text = '';
    textOverlay.isDragging = false;
  };

  const hideShapeOverlay = () => {
    shapeOverlay.visible = false;
    shapeOverlay.isDragging = false;
    shapeOverlay.isResizing = false;
    shapeOverlay.isRotating = false;
  };

  const hideBlurOverlay = () => {
    blurOverlay.visible = false;
    blurOverlay.isDragging = false;
    blurOverlay.isResizing = false;
  };

  const hideEmojiOverlay = () => {
    emojiOverlay.visible = false;
    emojiOverlay.emoji = '';
    emojiOverlay.isDragging = false;
    emojiOverlay.isResizing = false;
  };

  const drawTextToLayer = (
    text: string,
    x: number,
    y: number,
    fontSize: number,
    shouldCommitHistory = true
  ) => {
    const canvas = getCanvas();
    const context = directLayer.context;
    if (!canvas || !context) return;

    context.save();
    context.font = `600 ${fontSize}px Roboto, Arial, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineWidth = Math.max(2, fontSize * 0.08);
    context.strokeStyle = 'rgba(0,0,0,0.5)';
    context.fillStyle = '#ffffff';
    context.strokeText(text, x, y);
    context.fillText(text, x, y);
    context.restore();

    if (shouldCommitHistory) {
      commitHistory();
    }

    redraw();
  };

  const commitTextOverlay = () => {
    const text = textOverlay.text.trim();
    if (!textOverlay.visible || !text) {
      hideTextOverlay();
      return;
    }

    drawTextToLayer(text, textOverlay.x, textOverlay.y, textOverlay.fontSize);
    hideTextOverlay();
  };

  const drawShapeToLayer = (
    shape: ChatImageEditorShape,
    color: string,
    x: number,
    y: number,
    width: number,
    height: number,
    rotation: number,
    shouldCommitHistory = true
  ) => {
    const canvas = getCanvas();
    const context = directLayer.context;
    if (!canvas || !context) return;

    const normalizedWidth = Math.max(12, width);
    const normalizedHeight = Math.max(12, height);

    context.save();
    context.translate(x, y);
    context.rotate((rotation * Math.PI) / 180);
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = 5;
    context.lineCap = 'round';
    context.lineJoin = 'round';

    if (shape === 'circle') {
      context.beginPath();
      context.ellipse(
        0,
        0,
        normalizedWidth / 2,
        normalizedHeight / 2,
        0,
        0,
        Math.PI * 2
      );
      context.stroke();
    } else if (shape === 'line' || shape === 'arrow') {
      const fromX = -normalizedWidth / 2;
      const toX = normalizedWidth / 2;
      context.beginPath();
      context.moveTo(fromX, 0);
      context.lineTo(toX, 0);
      context.stroke();
      if (shape === 'arrow') {
        drawArrowHead(context, fromX, 0, toX, 0);
      }
    } else {
      context.strokeRect(
        -normalizedWidth / 2,
        -normalizedHeight / 2,
        normalizedWidth,
        normalizedHeight
      );
    }

    context.restore();

    if (shouldCommitHistory) {
      commitHistory();
    }

    redraw();
  };

  const commitShapeOverlay = () => {
    if (!shapeOverlay.visible) return;

    drawShapeToLayer(
      shapeOverlay.shape,
      shapeOverlay.color,
      shapeOverlay.x,
      shapeOverlay.y,
      shapeOverlay.width,
      shapeOverlay.height,
      shapeOverlay.rotation
    );
    hideShapeOverlay();
  };

  const drawPixelatedRegionToLayer = (
    x: number,
    y: number,
    width: number,
    height: number,
    intensity: number,
    shouldCommitHistory = true
  ) => {
    const canvas = getCanvas();
    const context = directLayer.context;
    if (!canvas || !context) return;

    redraw();

    const sourceX = Math.round(clamp(x - width / 2, 0, canvas.width));
    const sourceY = Math.round(clamp(y - height / 2, 0, canvas.height));
    const sourceWidth = Math.round(Math.min(width, canvas.width - sourceX));
    const sourceHeight = Math.round(Math.min(height, canvas.height - sourceY));
    if (sourceWidth < 8 || sourceHeight < 8) return;

    const source = document.createElement('canvas');
    source.width = sourceWidth;
    source.height = sourceHeight;
    const sourceContext = source.getContext('2d');
    if (!sourceContext) return;

    sourceContext.drawImage(
      canvas,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      sourceWidth,
      sourceHeight
    );

    const pixelSize = clamp(Math.round(intensity / 5), 4, 22);
    const pixelWidth = Math.max(1, Math.ceil(sourceWidth / pixelSize));
    const pixelHeight = Math.max(1, Math.ceil(sourceHeight / pixelSize));
    const pixelCanvas = document.createElement('canvas');
    pixelCanvas.width = pixelWidth;
    pixelCanvas.height = pixelHeight;
    const pixelContext = pixelCanvas.getContext('2d');
    if (!pixelContext) return;

    pixelContext.imageSmoothingEnabled = true;
    pixelContext.drawImage(source, 0, 0, pixelWidth, pixelHeight);

    context.save();
    context.imageSmoothingEnabled = false;
    context.drawImage(
      pixelCanvas,
      0,
      0,
      pixelWidth,
      pixelHeight,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight
    );
    context.restore();

    if (shouldCommitHistory) {
      commitHistory();
    }

    redraw();
  };

  const commitBlurOverlay = () => {
    if (!blurOverlay.visible) return;

    drawPixelatedRegionToLayer(
      blurOverlay.x,
      blurOverlay.y,
      blurOverlay.width,
      blurOverlay.height,
      blurOverlay.intensity
    );
    hideBlurOverlay();
  };

  const drawEmojiToLayer = (
    emoji: string,
    x: number,
    y: number,
    fontSize: number,
    shouldCommitHistory = true
  ) => {
    const canvas = getCanvas();
    const context = directLayer.context;
    if (!canvas || !context || !emoji) return;

    context.save();
    context.font = `${fontSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(emoji, x, y);
    context.restore();

    if (shouldCommitHistory) {
      commitHistory();
    }

    redraw();
  };

  const commitEmojiOverlay = () => {
    if (!emojiOverlay.visible || !emojiOverlay.emoji) {
      hideEmojiOverlay();
      return;
    }

    drawEmojiToLayer(
      emojiOverlay.emoji,
      emojiOverlay.x,
      emojiOverlay.y,
      emojiOverlay.fontSize
    );
    hideEmojiOverlay();
  };

  const drawBaseImage = (
    context: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    image: HTMLImageElement
  ) => {
    context.save();
    context.filter = getFilterStyle(activeFilter.value);
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((rotation.value * Math.PI) / 180);

    const isQuarterTurn = Math.abs(rotation.value % 180) === 90;
    const availableWidth = isQuarterTurn ? canvas.height : canvas.width;
    const availableHeight = isQuarterTurn ? canvas.width : canvas.height;
    const scale = Math.min(
      availableWidth / Math.max(1, image.naturalWidth),
      availableHeight / Math.max(1, image.naturalHeight)
    );
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;

    context.drawImage(image, -width / 2, -height / 2, width, height);
    context.restore();
  };

  const drawCropOverlay = (
    context: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    rect: CropRect
  ) => {
    const normalizedRect = normalizeCropRect(rect, canvas);

    context.save();
    context.fillStyle = 'rgba(15, 23, 42, 0.38)';
    context.fillRect(0, 0, canvas.width, normalizedRect.y);
    context.fillRect(0, normalizedRect.y, normalizedRect.x, normalizedRect.height);
    context.fillRect(
      normalizedRect.x + normalizedRect.width,
      normalizedRect.y,
      canvas.width - normalizedRect.x - normalizedRect.width,
      normalizedRect.height
    );
    context.fillRect(
      0,
      normalizedRect.y + normalizedRect.height,
      canvas.width,
      canvas.height - normalizedRect.y - normalizedRect.height
    );

    context.strokeStyle = '#25d366';
    context.lineWidth = 2;
    context.setLineDash([8, 6]);
    context.strokeRect(
      normalizedRect.x,
      normalizedRect.y,
      normalizedRect.width,
      normalizedRect.height
    );
    context.restore();
  };

  const redraw = () => {
    const canvas = getCanvas();
    const context = getContext();
    const image = sourceImage.value;
    if (!canvas || !context || !image) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    drawBaseImage(context, canvas, image);

    if (directLayer.canvas) {
      context.drawImage(directLayer.canvas, 0, 0);
    }

    if (cropRect.value) {
      drawCropOverlay(context, canvas, cropRect.value);
    }
  };

  const resizeCanvas = (naturalWidth: number, naturalHeight: number) => {
    const canvas = getCanvas();
    if (!canvas || !viewportRef.value) return;

    const viewport = viewportRef.value.getBoundingClientRect();
    const maxWidth = Math.max(280, viewport.width - 28);
    const maxHeight = Math.max(220, viewport.height - 28);
    const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight, 1);
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));

    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    syncDirectLayer(width, height);
    resetHistory();
  };

  const loadImage = async (src: string) => {
    await nextTick();

    const image = await loadHtmlImage(src);
    const naturalWidth = Math.max(1, image.naturalWidth || image.width || 1);
    const naturalHeight = Math.max(1, image.naturalHeight || image.height || 1);

    sourceImage.value = image;
    activeFilter.value = 'none';
    rotation.value = 0;
    cropRect.value = null;
    drawingMode.value = null;
    hideTextOverlay();
    hideShapeOverlay();
    hideBlurOverlay();
    hideEmojiOverlay();
    resizeCanvas(naturalWidth, naturalHeight);
    bindCanvasEvents();
    redraw();
  };

  const setDrawingMode = (
    enabled: boolean,
    options: { color: string; width: number; blur?: boolean }
  ) => {
    drawingMode.value = enabled ? options : null;
  };

  const resetInteraction = () => {
    commitTextOverlay();
    commitShapeOverlay();
    commitBlurOverlay();
    commitEmojiOverlay();
    drawingMode.value = null;
    cropRect.value = null;
    isPointerDrawing.value = false;
    isPointerCropping.value = false;
    pointerStart.value = null;
    lastPoint.value = null;
    redraw();
  };

  const applyFilter = (filter: ChatImageEditorFilter) => {
    activeFilter.value = filter;
    redraw();
  };

  const createCropRect = () => {
    const canvas = getCanvas();
    if (!canvas) return;

    const width = canvas.width * 0.72;
    const height = canvas.height * 0.72;
    cropRect.value = {
      x: (canvas.width - width) / 2,
      y: (canvas.height - height) / 2,
      width,
      height,
    };
    redraw();
  };

  const rotate = (degrees: number) => {
    rotation.value = (rotation.value + degrees) % 360;
    redraw();
  };

  const resetCropAndRotation = () => {
    cropRect.value = null;
    rotation.value = 0;
    isPointerCropping.value = false;
    pointerStart.value = null;
    redraw();
  };

  const addText = (text = 'Aa') => {
    const canvas = getCanvas();
    if (!canvas) return;

    commitTextOverlay();
    commitShapeOverlay();
    commitBlurOverlay();
    commitEmojiOverlay();
    textOverlay.visible = true;
    textOverlay.text = text;
    textOverlay.x = canvas.width / 2;
    textOverlay.y = canvas.height / 2;
    textOverlay.fontSize = 34;
    textOverlay.isDragging = false;
  };

  const addShape = (shape: ChatImageEditorShape, color: string) => {
    const canvas = getCanvas();
    if (!canvas) return;

    commitTextOverlay();
    commitShapeOverlay();
    commitBlurOverlay();
    commitEmojiOverlay();
    shapeOverlay.visible = true;
    shapeOverlay.shape = shape;
    shapeOverlay.color = color;
    shapeOverlay.x = canvas.width / 2;
    shapeOverlay.y = canvas.height / 2;
    shapeOverlay.width = Math.min(180, canvas.width * 0.42);
    shapeOverlay.height =
      shape === 'line' || shape === 'arrow' ? 42 : Math.min(120, canvas.height * 0.32);
    shapeOverlay.rotation = 0;
    shapeOverlay.isDragging = false;
    shapeOverlay.isResizing = false;
    shapeOverlay.isRotating = false;
  };

  const createBlurOverlay = (intensity = 50) => {
    const canvas = getCanvas();
    if (!canvas) return;

    commitTextOverlay();
    commitShapeOverlay();
    commitBlurOverlay();
    commitEmojiOverlay();
    blurOverlay.visible = true;
    blurOverlay.x = canvas.width / 2;
    blurOverlay.y = canvas.height / 2;
    blurOverlay.width = Math.min(220, canvas.width * 0.45);
    blurOverlay.height = Math.min(120, canvas.height * 0.28);
    blurOverlay.intensity = intensity;
    blurOverlay.isDragging = false;
    blurOverlay.isResizing = false;
  };

  const updateBlurIntensity = (intensity: number) => {
    blurOverlay.intensity = intensity;
  };

  const addEmoji = (emoji: string) => {
    if (!emoji) return;
    const canvas = getCanvas();
    if (!canvas) return;

    commitTextOverlay();
    commitShapeOverlay();
    commitBlurOverlay();
    commitEmojiOverlay();
    emojiOverlay.visible = true;
    emojiOverlay.emoji = emoji;
    emojiOverlay.x = canvas.width / 2;
    emojiOverlay.y = canvas.height / 2;
    emojiOverlay.fontSize = clamp(Math.round(Math.min(canvas.width, canvas.height) * 0.16), 42, 78);
    emojiOverlay.isDragging = false;
    emojiOverlay.isResizing = false;
  };

  const removeSelectedObject = () => {
    if (textOverlay.visible) {
      hideTextOverlay();
      return;
    }

    if (shapeOverlay.visible) {
      hideShapeOverlay();
      return;
    }

    if (blurOverlay.visible) {
      hideBlurOverlay();
      return;
    }

    if (emojiOverlay.visible) {
      hideEmojiOverlay();
      return;
    }

    if (!directLayer.context || !directLayer.canvas) return;

    directLayer.context.clearRect(0, 0, directLayer.canvas.width, directLayer.canvas.height);
    commitHistory();
    redraw();
  };

  const undo = () => {
    if (!canUndo.value) return;
    restoreHistory(historyIndex.value - 1);
  };

  const redo = () => {
    if (!canRedo.value) return;
    restoreHistory(historyIndex.value + 1);
  };

  const canvasToDataUrl = (sourceFile: File): string | null => {
    const canvas = getCanvas();
    if (!canvas) return null;

    const mimeType = getOutputMimeType(sourceFile);
    return canvas.toDataURL(mimeType, getOutputFormat(sourceFile) === 'png' ? undefined : 0.92);
  };

  const createCropResetState = async (
    sourceFile: File
  ): Promise<ChatImageCropResetState | null> => {
    const canvas = getCanvas();
    if (!canvas) return null;

    const previousRotation = rotation.value;
    const previousCropRect = cropRect.value;

    rotation.value = 0;
    cropRect.value = null;
    redraw();

    const preview = canvasToDataUrl(sourceFile);

    rotation.value = previousRotation;
    cropRect.value = previousCropRect;
    redraw();

    if (!preview) return null;

    return {
      file: await dataUrlToFile(preview, sourceFile),
      preview,
      edited: true,
    };
  };

  const exportVisibleCanvas = async (sourceFile: File): Promise<ChatImageExportResult | null> => {
    commitTextOverlay();
    commitShapeOverlay();
    commitBlurOverlay();
    commitEmojiOverlay();
    cropRect.value = null;
    redraw();

    const dataUrl = canvasToDataUrl(sourceFile);
    if (!dataUrl) return null;

    const file = await dataUrlToFile(dataUrl, sourceFile);
    return { file, preview: dataUrl };
  };

  const applyCrop = async (sourceFile: File): Promise<ChatImageExportResult | null> => {
    commitTextOverlay();
    commitShapeOverlay();
    commitBlurOverlay();
    commitEmojiOverlay();
    const canvas = getCanvas();
    if (!canvas || !cropRect.value) return exportVisibleCanvas(sourceFile);

    const rect = normalizeCropRect(cropRect.value, canvas);
    const cropReset = await createCropResetState(sourceFile);
    cropRect.value = null;
    redraw();

    if (rect.width < 8 || rect.height < 8) {
      return exportVisibleCanvas(sourceFile);
    }

    const output = document.createElement('canvas');
    output.width = Math.round(rect.width);
    output.height = Math.round(rect.height);
    const context = output.getContext('2d');
    if (!context) return null;

    context.drawImage(
      canvas,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      output.width,
      output.height
    );

    const mimeType = getOutputMimeType(sourceFile);
    const dataUrl = output.toDataURL(mimeType, getOutputFormat(sourceFile) === 'png' ? undefined : 0.92);
    const file = await dataUrlToFile(dataUrl, sourceFile);
    await loadImage(dataUrl);

    return { file, preview: dataUrl, cropReset };
  };

  const resetToSource = async (src: string) => {
    await loadImage(src);
  };

  const startTextDrag = (event: PointerEvent) => {
    const canvas = getCanvas();
    if (!canvas || !textOverlay.visible) return;

    const point = getCanvasPoint(event, canvas);
    textOverlay.isDragging = true;
    textOverlay.dragOffsetX = point.x - textOverlay.x;
    textOverlay.dragOffsetY = point.y - textOverlay.y;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const moveTextDrag = (event: PointerEvent) => {
    const canvas = getCanvas();
    if (!canvas || !textOverlay.visible || !textOverlay.isDragging) return;

    event.preventDefault();
    const point = getCanvasPoint(event, canvas);
    textOverlay.x = clamp(point.x - textOverlay.dragOffsetX, 0, canvas.width);
    textOverlay.y = clamp(point.y - textOverlay.dragOffsetY, 0, canvas.height);
  };

  const endTextDrag = (event: PointerEvent) => {
    textOverlay.isDragging = false;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
  };

  const startShapeDrag = (event: PointerEvent) => {
    const canvas = getCanvas();
    if (!canvas || !shapeOverlay.visible) return;

    const point = getCanvasPoint(event, canvas);
    shapeOverlay.isDragging = true;
    shapeOverlay.dragOffsetX = point.x - shapeOverlay.x;
    shapeOverlay.dragOffsetY = point.y - shapeOverlay.y;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const moveShapeDrag = (event: PointerEvent) => {
    const canvas = getCanvas();
    if (!canvas || !shapeOverlay.visible || !shapeOverlay.isDragging) return;

    event.preventDefault();
    const point = getCanvasPoint(event, canvas);
    shapeOverlay.x = clamp(point.x - shapeOverlay.dragOffsetX, 0, canvas.width);
    shapeOverlay.y = clamp(point.y - shapeOverlay.dragOffsetY, 0, canvas.height);
  };

  const endShapeDrag = (event: PointerEvent) => {
    shapeOverlay.isDragging = false;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
  };

  const startShapeResize = (event: PointerEvent) => {
    const canvas = getCanvas();
    if (!canvas || !shapeOverlay.visible) return;

    event.preventDefault();
    const point = getCanvasPoint(event, canvas);
    shapeOverlay.isResizing = true;
    shapeOverlay.resizeStartX = point.x;
    shapeOverlay.resizeStartY = point.y;
    shapeOverlay.resizeStartWidth = shapeOverlay.width;
    shapeOverlay.resizeStartHeight = shapeOverlay.height;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const moveShapeResize = (event: PointerEvent) => {
    const canvas = getCanvas();
    if (!canvas || !shapeOverlay.visible || !shapeOverlay.isResizing) return;

    event.preventDefault();
    const point = getCanvasPoint(event, canvas);
    const nextWidth = shapeOverlay.resizeStartWidth + (point.x - shapeOverlay.resizeStartX) * 2;
    const nextHeight = shapeOverlay.resizeStartHeight + (point.y - shapeOverlay.resizeStartY) * 2;
    shapeOverlay.width = clamp(nextWidth, 24, canvas.width);
    shapeOverlay.height = clamp(
      nextHeight,
      shapeOverlay.shape === 'line' || shapeOverlay.shape === 'arrow' ? 24 : 24,
      canvas.height
    );
  };

  const endShapeResize = (event: PointerEvent) => {
    shapeOverlay.isResizing = false;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
  };

  const startShapeRotate = (event: PointerEvent) => {
    const canvas = getCanvas();
    if (!canvas || !shapeOverlay.visible) return;

    event.preventDefault();
    const point = getCanvasPoint(event, canvas);
    shapeOverlay.isRotating = true;
    shapeOverlay.rotateStartAngle = getAngleDegrees(
      { x: shapeOverlay.x, y: shapeOverlay.y },
      point
    );
    shapeOverlay.rotateStartRotation = shapeOverlay.rotation;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const moveShapeRotate = (event: PointerEvent) => {
    const canvas = getCanvas();
    if (!canvas || !shapeOverlay.visible || !shapeOverlay.isRotating) return;

    event.preventDefault();
    const point = getCanvasPoint(event, canvas);
    const nextAngle = getAngleDegrees({ x: shapeOverlay.x, y: shapeOverlay.y }, point);
    shapeOverlay.rotation =
      shapeOverlay.rotateStartRotation + nextAngle - shapeOverlay.rotateStartAngle;
  };

  const endShapeRotate = (event: PointerEvent) => {
    shapeOverlay.isRotating = false;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
  };

  const startBlurDrag = (event: PointerEvent) => {
    const canvas = getCanvas();
    if (!canvas || !blurOverlay.visible) return;

    const point = getCanvasPoint(event, canvas);
    blurOverlay.isDragging = true;
    blurOverlay.dragOffsetX = point.x - blurOverlay.x;
    blurOverlay.dragOffsetY = point.y - blurOverlay.y;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const moveBlurDrag = (event: PointerEvent) => {
    const canvas = getCanvas();
    if (!canvas || !blurOverlay.visible || !blurOverlay.isDragging) return;

    event.preventDefault();
    const point = getCanvasPoint(event, canvas);
    blurOverlay.x = clamp(point.x - blurOverlay.dragOffsetX, 0, canvas.width);
    blurOverlay.y = clamp(point.y - blurOverlay.dragOffsetY, 0, canvas.height);
  };

  const endBlurDrag = (event: PointerEvent) => {
    blurOverlay.isDragging = false;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
  };

  const startBlurResize = (event: PointerEvent) => {
    const canvas = getCanvas();
    if (!canvas || !blurOverlay.visible) return;

    event.preventDefault();
    const point = getCanvasPoint(event, canvas);
    blurOverlay.isResizing = true;
    blurOverlay.resizeStartX = point.x;
    blurOverlay.resizeStartY = point.y;
    blurOverlay.resizeStartWidth = blurOverlay.width;
    blurOverlay.resizeStartHeight = blurOverlay.height;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const moveBlurResize = (event: PointerEvent) => {
    const canvas = getCanvas();
    if (!canvas || !blurOverlay.visible || !blurOverlay.isResizing) return;

    event.preventDefault();
    const point = getCanvasPoint(event, canvas);
    const nextWidth = blurOverlay.resizeStartWidth + (point.x - blurOverlay.resizeStartX) * 2;
    const nextHeight = blurOverlay.resizeStartHeight + (point.y - blurOverlay.resizeStartY) * 2;
    blurOverlay.width = clamp(nextWidth, 32, canvas.width);
    blurOverlay.height = clamp(nextHeight, 32, canvas.height);
  };

  const endBlurResize = (event: PointerEvent) => {
    blurOverlay.isResizing = false;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
  };

  const startEmojiDrag = (event: PointerEvent) => {
    const canvas = getCanvas();
    if (!canvas || !emojiOverlay.visible) return;

    const point = getCanvasPoint(event, canvas);
    emojiOverlay.isDragging = true;
    emojiOverlay.dragOffsetX = point.x - emojiOverlay.x;
    emojiOverlay.dragOffsetY = point.y - emojiOverlay.y;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const moveEmojiDrag = (event: PointerEvent) => {
    const canvas = getCanvas();
    if (!canvas || !emojiOverlay.visible || !emojiOverlay.isDragging) return;

    event.preventDefault();
    const point = getCanvasPoint(event, canvas);
    const margin = emojiOverlay.fontSize * 0.46;
    emojiOverlay.x = clamp(point.x - emojiOverlay.dragOffsetX, margin, canvas.width - margin);
    emojiOverlay.y = clamp(point.y - emojiOverlay.dragOffsetY, margin, canvas.height - margin);
  };

  const endEmojiDrag = (event: PointerEvent) => {
    emojiOverlay.isDragging = false;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
  };

  const startEmojiResize = (event: PointerEvent) => {
    const canvas = getCanvas();
    if (!canvas || !emojiOverlay.visible) return;

    event.preventDefault();
    const point = getCanvasPoint(event, canvas);
    emojiOverlay.isResizing = true;
    emojiOverlay.resizeStartX = point.x;
    emojiOverlay.resizeStartY = point.y;
    emojiOverlay.resizeStartFontSize = emojiOverlay.fontSize;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const moveEmojiResize = (event: PointerEvent) => {
    const canvas = getCanvas();
    if (!canvas || !emojiOverlay.visible || !emojiOverlay.isResizing) return;

    event.preventDefault();
    const point = getCanvasPoint(event, canvas);
    const delta = Math.max(
      point.x - emojiOverlay.resizeStartX,
      point.y - emojiOverlay.resizeStartY
    );
    emojiOverlay.fontSize = clamp(
      emojiOverlay.resizeStartFontSize + delta,
      28,
      Math.min(140, Math.max(canvas.width, canvas.height) * 0.42)
    );
  };

  const endEmojiResize = (event: PointerEvent) => {
    emojiOverlay.isResizing = false;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
  };

  const handlePointerDown = (event: PointerEvent) => {
    const canvas = getCanvas();
    if (!canvas || !sourceImage.value) return;

    const point = getCanvasPoint(event, canvas);
    canvas.setPointerCapture(event.pointerId);

    if (drawingMode.value) {
      isPointerDrawing.value = true;
      lastPoint.value = point;
      return;
    }

    if (cropRect.value) {
      isPointerCropping.value = true;
      pointerStart.value = point;
      cropRect.value = { x: point.x, y: point.y, width: 0, height: 0 };
      redraw();
    }
  };

  const handlePointerMove = (event: PointerEvent) => {
    const canvas = getCanvas();
    if (!canvas) return;

    const point = getCanvasPoint(event, canvas);

    if (isPointerDrawing.value && lastPoint.value && drawingMode.value && directLayer.context) {
      const context = directLayer.context;
      context.save();
      context.strokeStyle = drawingMode.value.blur ? 'rgba(226, 232, 240, 0.48)' : drawingMode.value.color;
      context.lineWidth = drawingMode.value.blur
        ? Math.max(18, drawingMode.value.width * 4)
        : drawingMode.value.width;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.shadowColor = drawingMode.value.blur ? 'rgba(148, 163, 184, 0.5)' : 'transparent';
      context.shadowBlur = drawingMode.value.blur ? 16 : 0;
      context.beginPath();
      context.moveTo(lastPoint.value.x, lastPoint.value.y);
      context.lineTo(point.x, point.y);
      context.stroke();
      context.restore();
      lastPoint.value = point;
      redraw();
      return;
    }

    if (isPointerCropping.value && pointerStart.value) {
      cropRect.value = {
        x: pointerStart.value.x,
        y: pointerStart.value.y,
        width: point.x - pointerStart.value.x,
        height: point.y - pointerStart.value.y,
      };
      redraw();
    }
  };

  const handlePointerUp = (event: PointerEvent) => {
    const canvas = getCanvas();
    const didDraw = isPointerDrawing.value;
    if (canvas?.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }

    isPointerDrawing.value = false;
    isPointerCropping.value = false;
    pointerStart.value = null;
    lastPoint.value = null;

    if (didDraw) {
      commitHistory();
    }
  };

  const dispose = () => {
    const canvas = getCanvas();
    if (canvas) {
      canvas.onpointerdown = null;
      canvas.onpointermove = null;
      canvas.onpointerup = null;
      canvas.onpointercancel = null;
    }

    sourceImage.value = null;
    cropRect.value = null;
    drawingMode.value = null;
    hideTextOverlay();
    hideShapeOverlay();
    hideBlurOverlay();
    hideEmojiOverlay();
    historyStack.value = [];
    historyIndex.value = -1;
    directLayer.canvas = null;
    directLayer.context = null;
  };

  const bindCanvasEvents = () => {
    const canvas = getCanvas();
    if (!canvas) return;

    canvas.onpointerdown = handlePointerDown;
    canvas.onpointermove = handlePointerMove;
    canvas.onpointerup = handlePointerUp;
    canvas.onpointercancel = handlePointerUp;
  };

  nextTick(bindCanvasEvents);
  onBeforeUnmount(dispose);

  return {
    activeFilter,
    canRedo,
    canUndo,
    blurOverlay,
    blurOverlayStyle,
    emojiOverlay,
    emojiOverlayStyle,
    hasCropRect,
    isReady,
    shapeOverlay,
    shapeOverlayStyle,
    textOverlay,
    textOverlayStyle,
    loadImage,
    setDrawingMode,
    resetInteraction,
    applyFilter,
    createBlurOverlay,
    updateBlurIntensity,
    createCropRect,
    rotate,
    resetCropAndRotation,
    addText,
    addShape,
    addEmoji,
    removeSelectedObject,
    redo,
    undo,
    startTextDrag,
    moveTextDrag,
    endTextDrag,
    startShapeDrag,
    moveShapeDrag,
    endShapeDrag,
    startShapeResize,
    moveShapeResize,
    endShapeResize,
    startShapeRotate,
    moveShapeRotate,
    endShapeRotate,
    startBlurDrag,
    moveBlurDrag,
    endBlurDrag,
    startBlurResize,
    moveBlurResize,
    endBlurResize,
    startEmojiDrag,
    moveEmojiDrag,
    endEmojiDrag,
    startEmojiResize,
    moveEmojiResize,
    endEmojiResize,
    exportVisibleCanvas,
    applyCrop,
    resetToSource,
    dispose,
  };
};
