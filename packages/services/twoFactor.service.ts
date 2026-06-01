import { injectable, inject } from 'tsyringe';
import { TwoFactorViewerRepository } from '@core/repositories/auth/TwoFactorViewer.repository';
import { TwoFactorUpdaterRepository } from '@core/repositories/auth/TwoFactorUpdater.repository';
import { ITwoFactorData } from '@core/common/interfaces/ITwoFactorData';
import { IFindTwoFactorByCodeAndEmailPhone } from '@core/common/interfaces/IFindTwoFactorByCodeAndEmailPhone';
import { IFindTwoFactorByTokenAndEmailPhone } from '@core/common/interfaces/IFindTwoFactorByTokenAndEmailPhone';

@injectable()
export class TwoFactorService {
  constructor(
    @inject(TwoFactorViewerRepository)
    private readonly twoFactorViewerRepository: TwoFactorViewerRepository,
    @inject(TwoFactorUpdaterRepository)
    private readonly twoFactorUpdaterRepository: TwoFactorUpdaterRepository
  ) {}

  findTwoFactorByCode = async (
    code: string
  ): Promise<ITwoFactorData | null> => {
    return this.twoFactorViewerRepository.findTwoFactorByCode(code);
  };

  findActiveValidationByCode = async (
    code: string
  ): Promise<ITwoFactorData | null> => {
    return this.twoFactorViewerRepository.findActiveValidationByCode(code);
  };

  findActiveValidationByCodeAndWorkerId = async (
    code: string,
    workerId: string
  ): Promise<ITwoFactorData | null> => {
    return this.twoFactorViewerRepository.findActiveValidationByCodeAndWorkerId(
      code,
      workerId
    );
  };

  findTwoFactorByCodeAndEmailPhone = async (
    data: IFindTwoFactorByCodeAndEmailPhone
  ): Promise<ITwoFactorData | null> => {
    return this.twoFactorViewerRepository.findTwoFactorByCodeAndEmailPhone(
      data
    );
  };

  findTwoFactorByTokenAndEmailPhone = async (
    data: IFindTwoFactorByTokenAndEmailPhone
  ): Promise<ITwoFactorData | null> => {
    return this.twoFactorViewerRepository.findTwoFactorByTokenAndEmailPhone(
      data
    );
  };

  updateDeletedAt = async (
    twoFactorId: string,
    deletedAt: string
  ): Promise<void> => {
    return this.twoFactorUpdaterRepository.updateDeletedAt(
      twoFactorId,
      deletedAt
    );
  };

  updateValidatedAt = async (
    twoFactorId: string,
    validatedAt: string
  ): Promise<void> => {
    return this.twoFactorUpdaterRepository.updateValidatedAt(
      twoFactorId,
      validatedAt
    );
  };
}
