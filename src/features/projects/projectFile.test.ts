import { describe, expect, it } from 'vitest';
import { createProject } from '../../model/factories';
import { defaultShape } from '../../model/overlays';
import { addShapeClip } from '../../model/timeline';
import { parseProjectFile, ProjectFileError, serializeProject } from './projectFile';

describe('project file', () => {
  it('round-trips the whole project, including shapes, blend modes and the media map', () => {
    const p = createProject('My film', '9:16');
    p.assets.a = { id: 'a', kind: 'video', name: 'clip.mp4', duration: 3, width: 1080, height: 1920, fileRef: { opfsPath: 'media/a' } };
    addShapeClip(p, 1, defaultShape('triangle'));
    p.tracks.at(-1)!.clips[0].blend = 'screen';
    const { project, media } = parseProjectFile(serializeProject(p, { a: 'media/a-clip.mp4' }));
    expect(project).toEqual(p);
    expect(media).toEqual({ a: 'media/a-clip.mp4' });
  });

  it('refuses other JSON, newer formats and broken projects with a reason', () => {
    expect(() => parseProjectFile('{"hello":1}')).toThrow(ProjectFileError);
    expect(() => parseProjectFile('not json')).toThrow(/not a project file/);
    const doc = JSON.parse(serializeProject(createProject('x')));
    expect(() => parseProjectFile(JSON.stringify({ ...doc, formatVersion: 99 }))).toThrow(/newer version/);
    doc.project.tracks[0].kind = 'lasers';
    expect(() => parseProjectFile(JSON.stringify(doc))).toThrow(/Invalid project at tracks.0.kind/);
  });
});
