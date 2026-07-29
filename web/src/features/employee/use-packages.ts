'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, downloadFile, uploadForm } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import type { EmployeePackage } from '@/lib/types';

/** 某模板的历史版本列表（仅平台运营可读）*/
export function useEmployeePackages(employeeId: string | undefined) {
  return useQuery({
    queryKey: qk.employeePackages(employeeId ?? ''),
    queryFn: () =>
      api.get<EmployeePackage[]>(`/digital-employees/${employeeId}/packages`),
    enabled: Boolean(employeeId),
  });
}

/**
 * 发布新版本（仅平台运营）。
 * 后端会在同一事务里落库并更新 DigitalEmployee.version，
 * 故成功后要一并失效员工列表与实例列表 —— 后者的升级提示会变。
 */
export function usePublishPackage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      employeeId,
      file,
      version,
      changelog,
    }: {
      employeeId: string;
      file: File;
      version: string;
      changelog?: string;
    }) => {
      const form = new FormData();
      form.append('file', file);
      form.append('version', version);
      if (changelog) form.append('changelog', changelog);
      return uploadForm<EmployeePackage>(
        `/digital-employees/${employeeId}/packages`,
        form,
      );
    },
    onSuccess: (_r, { employeeId }) => {
      qc.invalidateQueries({ queryKey: qk.employeePackages(employeeId) });
      qc.invalidateQueries({ queryKey: qk.employees() });
      qc.invalidateQueries({ queryKey: qk.instances });
      qc.invalidateQueries({ queryKey: qk.myEmployees });
    },
  });
}

/**
 * 下载某模板的最新员工包。
 * 需对该模板的某个 ACTIVE 实例有未过期授权（运营除外）。
 */
export function useDownloadPackage() {
  return useMutation({
    mutationFn: (employeeId: string) =>
      downloadFile(`/digital-employees/${employeeId}/package/download`),
  });
}
