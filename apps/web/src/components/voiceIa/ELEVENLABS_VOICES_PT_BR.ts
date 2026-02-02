const LEGACY_VOICE_REPLACEMENTS: Record<string, string> = {
  Antoni: 'Adam',
  Arnold: 'Adam',
  Charlotte: 'Helen',
  Clyde: 'Harry',
  Dave: 'Geoffrey',
  Domi: 'Laura',
  Dorothy: 'Evelyn',
  Drew: 'Bill',
  Emily: 'Clara',
  Ethan: 'Tom',
  Fin: 'Peter',
  Freya: 'Matilda',
  Gigi: 'Matilda',
  Giovanni: 'Mathis',
  Glinda: 'Janet',
  Grace: 'Riley',
  James: 'Daniel',
  Jeremy: 'Craig',
  Jessie: 'Julian',
  Joseph: 'Goliath',
  Josh: 'Craig',
  Michael: 'Robert',
  Mimi: 'Brenna',
  Nicole: 'Clara',
  Patrick: 'Liam',
  Paul: 'Bill',
  Rachel: 'Janet',
  Sam: 'Riley',
  Serena: 'Janet',
  Thomas: 'Tom',
};

const DEFAULT_VOICES = [
  { value: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel' },
  { value: 'pNInz6obpgDQGcFmaJgB', name: 'Adam' },
  { value: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah' },
  { value: 'ErXwobaYiN019PkySvjV', name: 'Antoni' },
  { value: 'VR6AewLTigWG4xSOukaG', name: 'Arnold' },
  { value: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel' },
  { value: 'ThT5KcBeYPX3keUQqHPh', name: 'Dorothy' },
  { value: 'pMsXgVXv3BLzUgSXRplE', name: 'Serena' },
  { value: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda' },
  { value: 'jsCqWAovK2LkecY7zXl4', name: 'Freya' },
  { value: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte' },
  { value: 'z9fAnlkpzviPz146aGWa', name: 'Glinda' },
  { value: 'oWAxZDx7w5VEj9dCyTzz', name: 'Grace' },
  { value: 'LcfcDJNUP1GQjkzn1xUU', name: 'Emily' },
  { value: 'GBv7mTt0atIp3Br8iCZE', name: 'Thomas' },
  { value: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi' },
  { value: 'jBpfuIE2acCO8z3wKNLl', name: 'Gigi' },
  { value: 'zcAOhNBS3c14rBihAFp1', name: 'Giovanni' },
  { value: 'piTKgcLEGmPE4e6mEKli', name: 'Nicole' },
  { value: 'flq6f7yk4E4fJM5XTYuZ', name: 'Michael' },
  { value: 'pqHfZKP75CvOlQylNhV4', name: 'Bill' },
  { value: 'nPczCjzI2devNBz1zQrb', name: 'Brian' },
  { value: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie' },
  { value: 'iP95p4xoKVk53GoZ742B', name: 'Chris' },
  { value: '2EiwWnXFnvU5JabPnv8n', name: 'Clyde' },
  { value: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum' },
  { value: 'CYw3kZ02Hs0563khs1Fj', name: 'Dave' },
  { value: '29vD33N1CtxCmqQRPOHJ', name: 'Drew' },
  { value: 'g5CIjZEefAph4nQFvHAz', name: 'Ethan' },
  { value: 'D38z5RcWu1voky8WS1ja', name: 'Fin' },
  { value: 'JBFqnCBsd6RMkjVDRZzb', name: 'George' },
  { value: 'SOYHLrjzK2X1ezoPC6cr', name: 'Harry' },
  { value: 'ZQe5CZNOzWyzPSCn5a3c', name: 'James' },
  { value: 'bVMeCyTHy58xNoL34h3p', name: 'Jeremy' },
  { value: 't0jbNlBVZ17f02VDIeMI', name: 'Jessie' },
  { value: 'Zlb1dXrM653N07WRdFW3', name: 'Joseph' },
  { value: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh' },
  { value: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam' },
  { value: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily' },
  { value: 'zrHiDhphv9ZnVXBqCLjz', name: 'Mimi' },
  { value: 'ODq5zmih8GrVes37Dizd', name: 'Patrick' },
  { value: '5Q0t7uMcjvnagumLfvZi', name: 'Paul' },
  { value: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam' },
  { value: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice' },
];

const CUSTOM_VOICES = [
  { value: '96cLX3dkyNUmTHwkNXeS', title: 'Thiago Realista' },
  { value: '36rVQA1AOIPwpA3Hg1tC', title: 'Matheus' },
  { value: 'CZD4BJ803C6T0alQxsR7', title: 'Andreia I.' },
  { value: 'Libc4Ixlrn2thn1XQaDL', title: 'Higor Bourges' },
  { value: '13auRs13gEKuqxX054G2', title: 'Gustavo Barros' },
  { value: 'NGS0ZsC7j4t4dCWbPdgO', title: 'Dhyogo Azevedo' },
  { value: 'qarDw4DEvUqP3FBlpO0T', title: 'JonOliveira' },
  { value: '29Pm0vQJJRoVfMCsUKB6', title: 'Márcio' },
  { value: 'tlcdlAx9D2VUpCZ2etQ7', title: 'Guilherme Converseiro' },
  { value: 'PZIBrGsMjLyYasEz50bI', title: 'Jennifer - Hyper-realistic' },
  { value: 'AaeZyyi87RCxtFnHPS3e', title: 'Prof. Campanholi' },
  { value: 'cQAY19cNx1hXYCYZV4ae', title: 'Deluca' },
  { value: 'nd1z1vC7yrh6u3ZztpCd', title: 'Renato' },
  { value: 'xWdpADtEio43ew1zGxUQ', title: 'Matheus Santos' },
  { value: 'IKpiSijWzlhOL6uX83EH', title: 'Will - Institucional' },
  { value: 'ojFdI32rbZHI2rxgzrEw', title: 'Nando Andrade' },
  { value: 'm151rjrbWXbBqyq56tly', title: 'Carla - Institucional' },
  { value: 'SVgp5d1fyFQRW1eQbwkq', title: 'Lucas' },
  { value: 'CbNfj17erd366KLOAufd', title: 'Guilherme Henrique' },
  { value: 'Jx7J2Fi5Ssla82TsW3YE', title: 'Cassio' },
  { value: 'y3X5crcIDtFawPx7bcNq', title: 'Eliel - Storyteller' },
  { value: 'OB6x7EbXYlhG4DDTB1XU', title: 'Michelle' },
  { value: 'eVXYtPVYB9wDoz9NVTIy', title: 'Carla' },
  { value: 'iScHbNW8K33gNo3lGgbo', title: 'Marianne' },
  { value: 'eQnBc1norhy4xHHbr9Ip', title: 'Cielo' },
  { value: 'x3mAOLD9WzlmrFCwA1S3', title: 'Evelin Perdomo' },
  { value: 'lWq4KDY8znfkV0DrK8Vb', title: 'Yasmin Alves' },
  { value: 'x8udhExu0uJxUn4Tf9Az', title: 'Slany' },
  { value: 'MZxV5lN3cv7hi1376O0m', title: 'Ana Dias' },
  { value: 'QJd9SLe6MVCdF6DR0EAu', title: 'Gabby' },
  { value: 'vibfi5nlk3hs8Mtvf9Oy', title: 'Ana - Brazilian' },
  { value: 'FIEA0c5UHH9JnvWaQrXS', title: 'Michele - Brazilian' },
  { value: 'nHNZWlqUWtEKPr3hhFQP', title: 'Daiane Candido' },
  { value: 'Eyspt3SYhZzXd1Jd3J8O', title: 'Bia - Brazilian' },
  { value: 'e70XR1sNoAGoLxPGL5f6', title: 'Márcio (alternativo)' },
  { value: '6pQlwCgfwffNdI3jjzM6', title: 'Fernando Borges' },
  { value: 'ylkAmqCrRDIZwbkOGyJe', title: 'Wlademir' },
  { value: 'UPTmB6OygMADpd4LOwE5', title: 'Vinicius Bergamo' },
  { value: 'WFSxKvz27RguNRD3Phoq', title: 'Wesley Bessa' },
  { value: 'UNlPbm2VdUhPl6lNL6D6', title: 'Diego' },
  { value: 'n2aB5UDlpf5USMJH7Qst', title: 'Gilson Lima' },
  { value: '6dHxv8ke5peKaO9xM46v', title: 'Gustavo Jannuzzi' },
  { value: 'hd5xzUNI8bF3Lvk3KkTO', title: 'Juliana Barbieri' },
  { value: 'ZxeM4498ujGNHYhQXtLS', title: 'Davi' },
  { value: 'JNI7HKGyqNaHqfihNoCi', title: 'Rener' },
  { value: 'gwiHKiILZ18I7Pb40yFN', title: 'FMDAmbrosio' },
  { value: 'hwnuNyWkl9DjdTFykrN6', title: 'Adriano - Narrator' },
  { value: 'ZAYPVq9zNssSHWCf6pko', title: 'Roberto Barbieri' },
  { value: '9pDzHy2OpOgeXM8SeL0t', title: 'Borges' },
];

const formatDefaultVoiceTitle = (name: string) => {
  const replacement = LEGACY_VOICE_REPLACEMENTS[name];
  if (replacement) {
    return `${name} (Free, Legacy -> ${replacement})`;
  }
  return `${name} (Free)`;
};

const buildDefaultVoices = () =>
  DEFAULT_VOICES.map(({ value, name }) => ({
    value,
    title: formatDefaultVoiceTitle(name),
    sortName: name,
  }));

const buildCustomVoices = () =>
  CUSTOM_VOICES.map(({ value, title }) => ({
    value,
    title,
    sortName: title,
  }));

const sortVoicesAsc = (voices: Array<{ sortName: string }>) =>
  voices.sort((a, b) =>
    a.sortName.localeCompare(b.sortName, 'pt-BR', { sensitivity: 'base' })
  );

export const ELEVENLABS_VOICES_PT_BR = sortVoicesAsc([
  ...buildDefaultVoices(),
  ...buildCustomVoices(),
]).map(({ sortName, ...voice }) => (void sortName, voice));
