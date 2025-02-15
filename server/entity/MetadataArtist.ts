import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
class MetadataArtist {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ unique: true })
  public mbArtistId: string;

  @Column({ nullable: true, type: 'varchar' })
  public tmdbPersonId: string | null;

  @Column({ nullable: true, type: 'varchar' })
  public tmdbThumb: string | null;

  @Column({ nullable: true, type: 'varchar' })
  public tadbThumb: string | null;

  @Column({ nullable: true, type: 'varchar' })
  public tadbCover: string | null;

  @CreateDateColumn()
  public createdAt: Date;

  @UpdateDateColumn()
  public updatedAt: Date;

  constructor(init?: Partial<MetadataArtist>) {
    Object.assign(this, init);
  }
}

export default MetadataArtist;
