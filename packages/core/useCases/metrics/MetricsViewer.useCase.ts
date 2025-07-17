import { injectable } from 'tsyringe';
import {
  ViewMetricsDisksResponse,
  ViewMetricsNetworksResponse,
  ViewMetricsResponse,
  ViewMetricsSocketsResponse,
} from '@core/schema/metrics/viewMetrics/response.schema';
import si from 'systeminformation';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { promises } from 'fs';

@injectable()
export class MetricsViewerUseCase {
  constructor() {}

  private readonly SAMPLE_INTERVAL_MS = 1000;
  private readonly IP_LATENCY_DNS_IP = '8.8.8.8';

  private async getSocketMetrics(
    conns: si.Systeminformation.NetworkConnectionsData[]
  ): Promise<ViewMetricsSocketsResponse> {
    const pid = process.pid;
    let openFds = 0;

    try {
      const fds = await promises.readdir(`/proc/${pid}/fd`);

      openFds = fds.length;
    } catch {
      openFds = 0;
    }

    let maxFds = 0;
    try {
      const lim = await promises.readFile('/proc/self/limits', 'utf8');
      const line = lim.split('\n').find((l) => l.startsWith('Max open files'));

      if (line) {
        const nums = line.match(/\d+/g);

        if (nums && nums.length) {
          maxFds = parseInt(nums[0], 10);
        }
      }
    } catch {
      const execAsync = promisify(exec);

      try {
        const { stdout } = await execAsync('ulimit -n', { timeout: 500 });

        maxFds = parseInt(stdout.trim(), 10) || 0;
      } catch {
        maxFds = 0;
      }
    }

    let connections = 0;
    try {
      connections = conns.filter((c) => c.state === 'ESTABLISHED').length;
    } catch {
      connections = 0;
    }

    return {
      open_fds: openFds,
      max_fds: maxFds,
      connections,
    };
  }

  private async getDiskReadStats(
    device = 'sda',
    sectorSize = 512
  ): Promise<{ busy_percentage: number; read_bytes_sec: number }> {
    const parseLine = (line: string) => {
      const cols = line.trim().split(/\s+/);
      return {
        sectorsRead: parseInt(cols[5], 10),
        ioTimeMs: parseInt(cols[12], 10),
      };
    };

    const readStats = async (): Promise<{
      sectorsRead: number;
      ioTimeMs: number;
    }> => {
      try {
        const raw = await promises.readFile('/proc/diskstats', 'utf8');
        const line = raw.split('\n').find((l) => l.split(/\s+/)[2] === device);

        if (!line) return { sectorsRead: 0, ioTimeMs: 0 };

        return parseLine(line);
      } catch {
        return { sectorsRead: 0, ioTimeMs: 0 };
      }
    };

    const start = await readStats();
    await new Promise((r) => setTimeout(r, this.SAMPLE_INTERVAL_MS));
    const end = await readStats();

    const deltaIoTime = end.ioTimeMs - start.ioTimeMs;
    const busyPct =
      this.SAMPLE_INTERVAL_MS > 0
        ? (deltaIoTime / this.SAMPLE_INTERVAL_MS) * 100
        : 0;
    const deltaSectors = end.sectorsRead - start.sectorsRead;
    const bytesRead = deltaSectors * sectorSize;
    const readBytesSec =
      this.SAMPLE_INTERVAL_MS > 0
        ? (bytesRead / this.SAMPLE_INTERVAL_MS) * 1000
        : 0;

    return {
      busy_percentage: Number(busyPct.toFixed(2)),
      read_bytes_sec: Number(readBytesSec.toFixed(2)),
    };
  }

  private async getCpuIowaitPct(intervalMs = 100): Promise<number> {
    const parseStat = (line: string) => {
      const parts = line
        .trim()
        .split(/\s+/)
        .slice(1)
        .map((v) => parseInt(v, 10));
      const total = parts.reduce((sum, n) => sum + n, 0);

      return { total, iowait: parts[4] };
    };

    const readCpu = async (): Promise<{ total: number; iowait: number }> => {
      try {
        const data = await promises.readFile('/proc/stat', 'utf8');
        const cpuLine = data.split('\n').find((l) => l.startsWith('cpu '));

        if (!cpuLine) return { total: 0, iowait: 0 };

        return parseStat(cpuLine);
      } catch {
        return { total: 0, iowait: 0 };
      }
    };

    const start = await readCpu();

    await new Promise((r) => setTimeout(r, intervalMs));

    const end = await readCpu();

    const deltaTotal = end.total - start.total;
    const deltaIowait = end.iowait - start.iowait;
    const pct = deltaTotal > 0 ? (deltaIowait / deltaTotal) * 100 : 0;

    return Number(pct.toFixed(2));
  }

  private getServerUptime(): number {
    return os.uptime();
  }

  private getCpuTemp(
    cpuTemperature: si.Systeminformation.CpuTemperatureData
  ): number {
    return Number((cpuTemperature.main ?? 0).toFixed(1));
  }

  private async getRtt(rtt: number): Promise<number> {
    return Number(rtt.toFixed(2));
  }

  private async getTcpRetransPct(): Promise<number> {
    let raw: string;
    try {
      raw = await promises.readFile('/proc/net/snmp', 'utf8');
    } catch {
      return 0;
    }

    const lines = raw.trim().split('\n');

    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].startsWith('Tcp:')) {
        const hdr = lines[i].trim().split(/\s+/);
        const vals = lines[i + 1].trim().split(/\s+/);

        const idxOutSegs = hdr.indexOf('OutSegs');
        const idxRetrans = hdr.indexOf('RetransSegs');

        if (idxOutSegs === -1 || idxRetrans === -1) break;

        const outSegs = parseInt(vals[idxOutSegs], 10);
        const retrans = parseInt(vals[idxRetrans], 10);

        const pct = outSegs ? (retrans / outSegs) * 100 : 0;

        return Number(pct.toFixed(2));
      }
    }

    return 0;
  }

  private async getEstablishedConns(
    conns: si.Systeminformation.NetworkConnectionsData[]
  ): Promise<number> {
    return conns.filter((c) => c.state === 'ESTABLISHED').length;
  }

  private async getNetworkQuality(
    rtt: number,
    conns: si.Systeminformation.NetworkConnectionsData[]
  ) {
    const [rttInfo, retransPct, established] = await Promise.all([
      this.getRtt(rtt),
      this.getTcpRetransPct(),
      this.getEstablishedConns(conns),
    ]);

    return {
      rtt_ms: rttInfo,
      retrans_percentage: retransPct,
      established_conns: established,
    };
  }

  private async networksInfo(
    defaultIface: string,
    ifaces:
      | si.Systeminformation.NetworkInterfacesData
      | si.Systeminformation.NetworkInterfacesData[],
    netStatsArray: si.Systeminformation.NetworkStatsData[],
    rtt: number,
    conns: si.Systeminformation.NetworkConnectionsData[]
  ): Promise<ViewMetricsNetworksResponse> {
    const ifaceArr = Array.isArray(ifaces) ? ifaces : [ifaces];

    const ifaceInfo = ifaceArr.find((i) => i.iface === defaultIface);
    const linkSpeedMbps = ifaceInfo?.speed ?? 0;
    const linkSpeedBps = linkSpeedMbps ? (linkSpeedMbps * 1_000_000) / 8 : 0;

    const netStats = netStatsArray.find((n) => n.iface === defaultIface);
    const uploadBpsRaw = netStats?.tx_sec ?? 0;
    const downloadBpsRaw = netStats?.rx_sec ?? 0;

    const uploadBps = Number(uploadBpsRaw.toFixed(2));
    const downloadBps = Number(downloadBpsRaw.toFixed(2));

    const uploadPct = linkSpeedBps
      ? Number(((uploadBps / linkSpeedBps) * 100).toFixed(2))
      : 0;

    const downloadPct = linkSpeedBps
      ? Number(((downloadBps / linkSpeedBps) * 100).toFixed(2))
      : 0;

    const getNetwork = await this.getNetworkQuality(rtt, conns);

    return {
      speed: linkSpeedBps,
      upload: uploadBps,
      upload_percentage: uploadPct,
      download: downloadBps,
      download_percentage: downloadPct,
      rtt_ms: getNetwork.rtt_ms,
      retrans_percentage: getNetwork.retrans_percentage,
      established_conns: getNetwork.established_conns,
      errors: (netStats?.rx_errors ?? 0) + (netStats?.tx_errors ?? 0),
    };
  }

  private async diskInfo(
    disk: si.Systeminformation.FsSizeData[]
  ): Promise<ViewMetricsDisksResponse> {
    const diskStats = await Promise.all(
      disk.map(async (d) => {
        const part = d.fs.split('/').pop() ?? '';
        const device = part.replace(/\d+$/, '');
        const { busy_percentage, read_bytes_sec } =
          await this.getDiskReadStats(device);

        return {
          fs: d.fs,
          type: d.type,
          size: d.size,
          used: d.used,
          available: d.available,
          busy_percentage,
          read_bytes_sec,
        };
      })
    );

    const totalSize = diskStats.reduce((acc, disk) => acc + disk.size, 0);
    const totalUsed = diskStats.reduce((acc, disk) => acc + disk.used, 0);
    const totalAvailable = diskStats.reduce(
      (acc, disk) => acc + disk.available,
      0
    );
    const busyPercentage = diskStats.reduce(
      (acc, disk) => acc + disk.busy_percentage,
      0
    );
    const readBytesSec = diskStats.reduce(
      (acc, disk) => acc + disk.read_bytes_sec,
      0
    );

    return {
      used: totalUsed,
      available: totalAvailable,
      size: totalSize,
      busy_percentage: Number((busyPercentage / diskStats.length).toFixed(2)),
      read_bytes_sec: Number((readBytesSec / diskStats.length).toFixed(2)),
      disks: diskStats,
    };
  }

  private loadAvg(): [number, number, number] {
    const [load1, load5, load15] = os.loadavg();

    const loadAvg = [
      Number(load1.toFixed(2)),
      Number(load5.toFixed(2)),
      Number(load15.toFixed(2)),
    ] as [number, number, number];

    return loadAvg;
  }

  async execute(): Promise<ViewMetricsResponse> {
    const [
      cpuInfo,
      cpuTemperature,
      currentLoad,
      memInfo,
      disk,
      defaultIface,
      ifaces,
      netStatsArray,
      osInfo,
      networkConnectionsInfo,
      inetLatencyInfo,
    ] = await Promise.all([
      si.cpu(),
      si.cpuTemperature(),
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.networkInterfaceDefault(),
      si.networkInterfaces(),
      si.networkStats(),
      si.osInfo(),
      si.networkConnections(),
      si.inetLatency(this.IP_LATENCY_DNS_IP),
    ]);

    const usage = parseFloat(currentLoad.currentLoad.toFixed(2));

    const [networksInfo, cpuIowait, diskInfo, getOpenFileDescriptors] =
      await Promise.all([
        this.networksInfo(
          defaultIface,
          ifaces,
          netStatsArray,
          inetLatencyInfo,
          networkConnectionsInfo
        ),
        this.getCpuIowaitPct(),
        this.diskInfo(disk),
        this.getSocketMetrics(networkConnectionsInfo),
      ]);

    const response: ViewMetricsResponse = {
      cpu: {
        manufacturer: cpuInfo.manufacturer,
        brand: cpuInfo.brand,
        cores: cpuInfo.cores,
        usage,
        load_avg: this.loadAvg(),
        temperature: this.getCpuTemp(cpuTemperature),
        iowait_percentage: cpuIowait,
      },
      memory: {
        total: memInfo.total,
        used: memInfo.used,
        free: memInfo.free,
      },
      disk: diskInfo,
      network: networksInfo,
      os: {
        platform: osInfo.platform,
        distro: osInfo.distro,
        release: osInfo.release,
        codename: osInfo.codename,
        kernel: osInfo.kernel,
        arch: osInfo.arch,
        hostname: osInfo.hostname,
      },
      uptime: this.getServerUptime(),
      sockets: getOpenFileDescriptors,
    };

    return response;
  }
}
