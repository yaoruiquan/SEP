import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DigitalEmployeeCreateDto,
  DigitalEmployeeUpdateDto,
  BindCapabilityDto,
} from 'shared';

@Injectable()
export class DigitalEmployeeService {
  constructor(private readonly prisma: PrismaService) {}

  // ────────────────────────────────────────────────────────────────────────────
  // CRUD
  // ────────────────────────────────────────────────────────────────────────────

  async create(dto: DigitalEmployeeCreateDto) {
    if (dto.capabilityIds.length > 0) {
      await this.validateCapabilitiesApproved(dto.capabilityIds);
    }

    // Build base data object explicitly to satisfy Prisma's required field types
    const baseData = {
      name: dto.name,
      description: dto.description,
      industry: dto.industry,
      position: dto.position,
      avatar: dto.avatar,
      systemPrompt: dto.systemPrompt,
      modelId: dto.modelId,
      maxSteps: dto.maxSteps,
      price: dto.price,
    };

    if (dto.capabilityIds.length > 0) {
      return this.prisma.digitalEmployee.create({
        data: {
          ...baseData,
          bindings: {
            create: dto.capabilityIds.map((capabilityId, index) => ({
              capabilityId,
              order: index,
            })),
          },
        },
        include: this.defaultInclude(),
      });
    }

    return this.prisma.digitalEmployee.create({
      data: baseData,
      include: this.defaultInclude(),
    });
  }

  async findAll(status?: string) {
    return this.prisma.digitalEmployee.findMany({
      where: status ? { status: status as any } : undefined,
      include: {
        ...this.defaultInclude(),
        _count: { select: { subscriptions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const employee = await this.prisma.digitalEmployee.findUnique({
      where: { id },
      include: {
        bindings: {
          include: {
            capability: {
              select: {
                id: true,
                name: true,
                type: true,
                description: true,
                inputSchema: true,
                outputSchema: true,
                status: true,
              },
            },
          },
          orderBy: { order: 'asc' },
        },
        _count: { select: { subscriptions: true } },
      },
    });

    if (!employee) {
      throw new NotFoundException(`Digital employee ${id} not found`);
    }

    return employee;
  }

  async update(id: string, dto: DigitalEmployeeUpdateDto) {
    await this.findOne(id); // guard: throws NotFoundException if missing

    return this.prisma.digitalEmployee.update({
      where: { id },
      data: {
        ...dto,
        // Auto-stamp publishedAt when status transitions to PUBLISHED
        ...(dto.status === 'PUBLISHED' && { publishedAt: new Date() }),
      },
      include: this.defaultInclude(),
    });
  }

  async remove(id: string) {
    await this.findOne(id); // guard
    await this.prisma.digitalEmployee.delete({ where: { id } });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Capability Binding
  // ────────────────────────────────────────────────────────────────────────────

  async bindCapability(employeeId: string, dto: BindCapabilityDto) {
    await this.findOne(employeeId);
    await this.validateCapabilitiesApproved([dto.capabilityId]);

    try {
      return await this.prisma.employeeCapabilityBinding.create({
        data: { employeeId, capabilityId: dto.capabilityId, order: dto.order },
        include: {
          capability: { select: { id: true, name: true, type: true, description: true } },
        },
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        throw new ConflictException('Capability already bound to this employee');
      }
      throw err;
    }
  }

  async unbindCapability(employeeId: string, capabilityId: string) {
    await this.findOne(employeeId);

    const binding = await this.prisma.employeeCapabilityBinding.findUnique({
      where: { employeeId_capabilityId: { employeeId, capabilityId } },
    });

    if (!binding) {
      throw new NotFoundException('Capability binding not found');
    }

    await this.prisma.employeeCapabilityBinding.delete({
      where: { employeeId_capabilityId: { employeeId, capabilityId } },
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────────────

  private defaultInclude() {
    return {
      bindings: {
        include: {
          capability: { select: { id: true, name: true, type: true } },
        },
        orderBy: { order: 'asc' as const },
      },
    };
  }

  private async validateCapabilitiesApproved(capabilityIds: string[]) {
    const capabilities = await this.prisma.capability.findMany({
      where: { id: { in: capabilityIds } },
      select: { id: true, status: true, name: true },
    });

    if (capabilities.length !== capabilityIds.length) {
      const foundIds = new Set(capabilities.map((c) => c.id));
      const missing = capabilityIds.filter((id) => !foundIds.has(id));
      throw new NotFoundException(`Capabilities not found: ${missing.join(', ')}`);
    }

    const notApproved = capabilities.filter((c) => c.status !== 'APPROVED');
    if (notApproved.length > 0) {
      const names = notApproved.map((c) => `${c.name} (${c.status})`).join(', ');
      throw new BadRequestException(`Capabilities not approved: ${names}`);
    }
  }
}
