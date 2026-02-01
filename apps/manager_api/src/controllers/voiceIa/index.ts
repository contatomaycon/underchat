import { injectable } from 'tsyringe';
import { listVoiceIa } from './methods/listVoiceIa';
import { createVoiceIa } from './methods/createVoiceIa';
import { viewVoiceIa } from './methods/viewVoiceIa';
import { updateVoiceIa } from './methods/updateVoiceIa';
import { deleteVoiceIa } from './methods/deleteVoiceIa';

@injectable()
class VoiceIaController {
  public listVoiceIa = listVoiceIa;
  public createVoiceIa = createVoiceIa;
  public viewVoiceIa = viewVoiceIa;
  public updateVoiceIa = updateVoiceIa;
  public deleteVoiceIa = deleteVoiceIa;
}

export default VoiceIaController;
